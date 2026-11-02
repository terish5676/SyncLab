import threading
import time
from abc import ABC, abstractmethod
from typing import Optional
from .models import SemaphoreState

class BaseSyncStrategy(ABC):
    """
    Abstract base class for Reader-Writer Synchronization Algorithms.
    Supports cancellation and cooperative pause barriers to prevent thread leaks and deadlocks.
    """
    def __init__(self):
        self._state_lock = threading.Lock()
        self.waiting_readers: int = 0
        self.waiting_writers: int = 0

    @abstractmethod
    def reader_enter(self, stop_event: threading.Event, pause_event: Optional[threading.Event] = None) -> bool:
        """Called by a reader before entering the critical section. Returns False if cancelled."""
        pass

    @abstractmethod
    def reader_exit(self) -> None:
        """Called by a reader after leaving the critical section."""
        pass

    @abstractmethod
    def writer_enter(self, stop_event: threading.Event, pause_event: Optional[threading.Event] = None) -> bool:
        """Called by a writer before entering the critical section. Returns False if cancelled."""
        pass

    @abstractmethod
    def writer_exit(self) -> None:
        """Called by a writer after leaving the critical section."""
        pass

    @abstractmethod
    def get_state(self) -> SemaphoreState:
        """Returns the current state of locks and counters for visual inspection."""
        pass

    def _acquire_with_cancellation(
        self,
        sem: threading.Semaphore,
        stop_event: threading.Event,
        pause_event: Optional[threading.Event] = None,
        timeout: float = 0.1
    ) -> bool:
        """Helper to acquire a semaphore while respecting stop and pause events."""
        while not stop_event.is_set():
            if pause_event is not None and not pause_event.is_set():
                pause_event.wait(timeout=0.1)
                continue
            if sem.acquire(timeout=timeout):
                return True
        return False


class ReaderPreferenceStrategy(BaseSyncStrategy):
    """
    Courtois et al. (1971) First Readers-Writers Solution:
    - Readers share access.
    - Writers wait until active readers finish.
    - If continuous readers arrive, writers can starve indefinitely.
    """
    def __init__(self):
        super().__init__()
        self.mutex = threading.Semaphore(1)
        self.resource_lock = threading.Semaphore(1)
        self.read_count: int = 0

    def reader_enter(self, stop_event: threading.Event, pause_event: Optional[threading.Event] = None) -> bool:
        with self._state_lock:
            self.waiting_readers += 1

        if not self._acquire_with_cancellation(self.mutex, stop_event, pause_event):
            with self._state_lock:
                self.waiting_readers -= 1
            return False

        self.read_count += 1
        first_reader = (self.read_count == 1)
        self.mutex.release()

        if first_reader:
            if not self._acquire_with_cancellation(self.resource_lock, stop_event, pause_event):
                with self.mutex:
                    self.read_count -= 1
                with self._state_lock:
                    self.waiting_readers -= 1
                return False

        with self._state_lock:
            self.waiting_readers -= 1
        return True

    def reader_exit(self) -> None:
        self.mutex.acquire()
        self.read_count -= 1
        last_reader = (self.read_count == 0)
        if last_reader:
            self.resource_lock.release()
        self.mutex.release()

    def writer_enter(self, stop_event: threading.Event, pause_event: Optional[threading.Event] = None) -> bool:
        with self._state_lock:
            self.waiting_writers += 1

        if not self._acquire_with_cancellation(self.resource_lock, stop_event, pause_event):
            with self._state_lock:
                self.waiting_writers -= 1
            return False

        with self._state_lock:
            self.waiting_writers -= 1
        return True

    def writer_exit(self) -> None:
        self.resource_lock.release()

    def get_state(self) -> SemaphoreState:
        with self._state_lock:
            return SemaphoreState(
                read_count=self.read_count,
                write_count=0,
                waiting_readers=self.waiting_readers,
                waiting_writers=self.waiting_writers,
                resource_locked=(self.read_count > 0 or self.waiting_writers > 0),
                read_try_locked=False,
                turnstile_busy=False,
                admission_policy="Readers share access. First reader locks out writers. Writers wait until read_count drops to 0. Arriving readers can starve writers."
            )


class WriterPreferenceStrategy(BaseSyncStrategy):
    """
    Courtois et al. (1971) Second Readers-Writers Solution:
    - Prioritizes waiting writers over newly arriving readers.
    - An arriving writer prevents subsequent readers from entering.
    - Readers may starve if writers arrive continuously.
    """
    def __init__(self):
        super().__init__()
        self.mutex_r = threading.Semaphore(1)
        self.mutex_w = threading.Semaphore(1)
        self.read_try = threading.Semaphore(1)
        self.resource_lock = threading.Semaphore(1)

        self.read_count: int = 0
        self.write_count: int = 0

    def reader_enter(self, stop_event: threading.Event, pause_event: Optional[threading.Event] = None) -> bool:
        with self._state_lock:
            self.waiting_readers += 1

        if not self._acquire_with_cancellation(self.read_try, stop_event, pause_event):
            with self._state_lock:
                self.waiting_readers -= 1
            return False

        if not self._acquire_with_cancellation(self.mutex_r, stop_event, pause_event):
            self.read_try.release()
            with self._state_lock:
                self.waiting_readers -= 1
            return False

        self.read_count += 1
        first_reader = (self.read_count == 1)
        self.mutex_r.release()

        if first_reader:
            if not self._acquire_with_cancellation(self.resource_lock, stop_event, pause_event):
                with self.mutex_r:
                    self.read_count -= 1
                self.read_try.release()
                with self._state_lock:
                    self.waiting_readers -= 1
                return False

        self.read_try.release()
        with self._state_lock:
            self.waiting_readers -= 1
        return True

    def reader_exit(self) -> None:
        self.mutex_r.acquire()
        self.read_count -= 1
        last_reader = (self.read_count == 0)
        if last_reader:
            self.resource_lock.release()
        self.mutex_r.release()

    def writer_enter(self, stop_event: threading.Event, pause_event: Optional[threading.Event] = None) -> bool:
        with self._state_lock:
            self.waiting_writers += 1

        if not self._acquire_with_cancellation(self.mutex_w, stop_event, pause_event):
            with self._state_lock:
                self.waiting_writers -= 1
            return False

        self.write_count += 1
        first_writer = (self.write_count == 1)
        self.mutex_w.release()

        if first_writer:
            if not self._acquire_with_cancellation(self.read_try, stop_event, pause_event):
                with self.mutex_w:
                    self.write_count -= 1
                with self._state_lock:
                    self.waiting_writers -= 1
                return False

        if not self._acquire_with_cancellation(self.resource_lock, stop_event, pause_event):
            with self.mutex_w:
                self.write_count -= 1
                if self.write_count == 0:
                    self.read_try.release()
            with self._state_lock:
                self.waiting_writers -= 1
            return False

        with self._state_lock:
            self.waiting_writers -= 1
        return True

    def writer_exit(self) -> None:
        self.resource_lock.release()
        self.mutex_w.acquire()
        self.write_count -= 1
        last_writer = (self.write_count == 0)
        if last_writer:
            self.read_try.release()
        self.mutex_w.release()

    def get_state(self) -> SemaphoreState:
        with self._state_lock:
            return SemaphoreState(
                read_count=self.read_count,
                write_count=self.write_count,
                waiting_readers=self.waiting_readers,
                waiting_writers=self.waiting_writers,
                resource_locked=(self.read_count > 0 or self.write_count > 0),
                read_try_locked=(self.write_count > 0),
                turnstile_busy=False,
                admission_policy="Writers have priority. When any writer queues, read_try is locked against incoming readers. Arriving writers can starve readers."
            )


class FairFIFOStrategy(BaseSyncStrategy):
    """
    Starvation-Free Fair FIFO Turnstile Admission:
    - Every arriving process (reader or writer) queues at a common turnstile.
    - Readers in a contiguous batch can still read concurrently.
    - No subsequent reader can bypass a waiting writer.
    - Preserves request order and prevents starvation for both readers and writers.
    """
    def __init__(self):
        super().__init__()
        self.order_queue = threading.Semaphore(1)
        self.mutex_r = threading.Semaphore(1)
        self.resource_lock = threading.Semaphore(1)
        self.read_count: int = 0
        self.turnstile_active: bool = False

    def reader_enter(self, stop_event: threading.Event, pause_event: Optional[threading.Event] = None) -> bool:
        with self._state_lock:
            self.waiting_readers += 1

        if not self._acquire_with_cancellation(self.order_queue, stop_event, pause_event):
            with self._state_lock:
                self.waiting_readers -= 1
            return False

        if not self._acquire_with_cancellation(self.mutex_r, stop_event, pause_event):
            self.order_queue.release()
            with self._state_lock:
                self.waiting_readers -= 1
            return False

        self.read_count += 1
        first_reader = (self.read_count == 1)
        self.mutex_r.release()

        if first_reader:
            if not self._acquire_with_cancellation(self.resource_lock, stop_event, pause_event):
                with self.mutex_r:
                    self.read_count -= 1
                self.order_queue.release()
                with self._state_lock:
                    self.waiting_readers -= 1
                return False

        self.order_queue.release()

        with self._state_lock:
            self.waiting_readers -= 1
        return True

    def reader_exit(self) -> None:
        self.mutex_r.acquire()
        self.read_count -= 1
        last_reader = (self.read_count == 0)
        if last_reader:
            self.resource_lock.release()
        self.mutex_r.release()

    def writer_enter(self, stop_event: threading.Event, pause_event: Optional[threading.Event] = None) -> bool:
        with self._state_lock:
            self.waiting_writers += 1

        if not self._acquire_with_cancellation(self.order_queue, stop_event, pause_event):
            with self._state_lock:
                self.waiting_writers -= 1
            return False

        if not self._acquire_with_cancellation(self.resource_lock, stop_event, pause_event):
            self.order_queue.release()
            with self._state_lock:
                self.waiting_writers -= 1
            return False

        self.order_queue.release()

        with self._state_lock:
            self.waiting_writers -= 1
        return True

    def writer_exit(self) -> None:
        self.resource_lock.release()

    def get_state(self) -> SemaphoreState:
        with self._state_lock:
            return SemaphoreState(
                read_count=self.read_count,
                write_count=0,
                waiting_readers=self.waiting_readers,
                waiting_writers=self.waiting_writers,
                resource_locked=(self.read_count > 0 or self.waiting_writers > 0),
                read_try_locked=False,
                turnstile_busy=(self.waiting_readers + self.waiting_writers > 0),
                admission_policy="FIFO Fair Turnstile. Processes are admitted strictly in order of request. Readers read concurrently if consecutive. Neither readers nor writers starve."
            )

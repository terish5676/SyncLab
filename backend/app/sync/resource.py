import threading
import time
from typing import Optional, Set, Tuple
from .models import WriterOperation

class InvariantViolationError(RuntimeError):
    """Raised when a Reader-Writer safety invariant is violated."""
    pass

class SharedResource:
    """
    Thread-safe protected shared resource with strict invariant assertions
    and real-time occupancy accounting.
    """
    def __init__(self, initial_value: int = 100):
        self._lock = threading.Lock()
        self._value: int = initial_value
        self._version: int = 0
        self._active_readers: Set[str] = set()
        self._active_writer: Optional[str] = None

        # Resource occupancy tracking
        self._total_occupied_time: float = 0.0
        self._last_state_change: float = time.monotonic()
        self._is_occupied: bool = False

    def enter_read(self, process_id: str) -> None:
        with self._lock:
            if self._active_writer is not None:
                raise InvariantViolationError(
                    f"Invariant 1 Violated: Reader {process_id} entered while writer {self._active_writer} is active!"
                )
            now = time.monotonic()
            if not self._is_occupied:
                self._is_occupied = True
                self._last_state_change = now

            self._active_readers.add(process_id)

    def read_value(self, process_id: str) -> Tuple[int, int]:
        with self._lock:
            if self._active_writer is not None:
                raise InvariantViolationError(
                    f"Invariant 1 Violated: Reader {process_id} read while writer {self._active_writer} active!"
                )
            if process_id not in self._active_readers:
                raise InvariantViolationError(
                    f"Process {process_id} attempted reading without an active lease!"
                )
            return self._value, self._version

    def exit_read(self, process_id: str) -> None:
        with self._lock:
            if process_id not in self._active_readers:
                raise InvariantViolationError(
                    f"Reader {process_id} exiting read lease but was not registered as active!"
                )
            self._active_readers.remove(process_id)
            now = time.monotonic()
            if len(self._active_readers) == 0 and self._active_writer is None:
                self._total_occupied_time += (now - self._last_state_change)
                self._is_occupied = False
                self._last_state_change = now

    def enter_write(self, process_id: str) -> None:
        with self._lock:
            if self._active_writer is not None:
                raise InvariantViolationError(
                    f"Invariant 2 Violated: Writer {process_id} entered while writer {self._active_writer} is active!"
                )
            if len(self._active_readers) > 0:
                raise InvariantViolationError(
                    f"Invariant 1 Violated: Writer {process_id} entered while readers {list(self._active_readers)} are active!"
                )
            now = time.monotonic()
            if not self._is_occupied:
                self._is_occupied = True
                self._last_state_change = now

            self._active_writer = process_id

    def execute_write(self, process_id: str, op: WriterOperation, amount: int) -> Tuple[int, int]:
        with self._lock:
            if self._active_writer != process_id:
                raise InvariantViolationError(
                    f"Process {process_id} attempted write without exclusive lease!"
                )
            if len(self._active_readers) > 0:
                raise InvariantViolationError(
                    f"Invariant 1 Violated: Write occurred while {len(self._active_readers)} readers were active!"
                )

            # Apply atomic write mutation
            old_val = self._value
            if op == WriterOperation.ADD:
                self._value += amount
            elif op == WriterOperation.SUBTRACT:
                self._value -= amount
            elif op == WriterOperation.MULTIPLY:
                self._value *= amount
            elif op == WriterOperation.SET:
                self._value = amount

            self._version += 1
            return self._value, self._version

    def exit_write(self, process_id: str) -> None:
        with self._lock:
            if self._active_writer != process_id:
                raise InvariantViolationError(
                    f"Writer {process_id} exiting but active writer was {self._active_writer}!"
                )
            self._active_writer = None
            now = time.monotonic()
            if len(self._active_readers) == 0:
                self._total_occupied_time += (now - self._last_state_change)
                self._is_occupied = False
                self._last_state_change = now

    def get_snapshot(self) -> Tuple[int, int, Set[str], Optional[str]]:
        with self._lock:
            return self._value, self._version, set(self._active_readers), self._active_writer

    def get_occupancy_ratio(self, total_elapsed_sec: float) -> float:
        with self._lock:
            occupied = self._total_occupied_time
            if self._is_occupied:
                occupied += (time.monotonic() - self._last_state_change)
            if total_elapsed_sec <= 0.0001:
                return 0.0
            ratio = (occupied / total_elapsed_sec) * 100.0
            return max(0.0, min(100.0, ratio))


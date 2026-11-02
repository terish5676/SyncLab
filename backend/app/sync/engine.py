import threading
import time
import uuid
from datetime import datetime, timezone
from typing import List, Dict, Optional, Callable, Set
import asyncio

from .models import (
    AlgorithmType,
    ProcessType,
    ProcessState,
    ProcessInfo,
    SimulationConfig,
    SimulationEvent,
    SimulationStatus,
    SimulationMetrics,
    SimulationStateResponse,
    WriterOperation,
)
from .resource import SharedResource
from .algorithms import (
    BaseSyncStrategy,
    ReaderPreferenceStrategy,
    WriterPreferenceStrategy,
    FairFIFOStrategy,
)

class SimulationEngine:
    """
    Manages concurrent thread lifecycles, real-time event streaming,
    invariant verification, and performance metric derivation.
    """
    def __init__(
        self,
        config: SimulationConfig,
        event_callback: Optional[Callable[[SimulationEvent], None]] = None,
        loop: Optional[asyncio.AbstractEventLoop] = None
    ):
        self.simulation_id = str(uuid.uuid4())[:8]
        self.config = config
        self.event_callback = event_callback
        self.loop = loop

        # Threading and synchronization state
        self._lock = threading.Lock()
        self.status = SimulationStatus.IDLE
        self.stop_event = threading.Event()
        self.pause_event = threading.Event()
        self.pause_event.set()  # Set = running, Clear = paused
        self.pause_start_mono: float = 0.0
        self.total_paused_sec: float = 0.0
        self.start_mono: float = 0.0
        self.end_mono: float = 0.0

        # Create Strategy
        if config.algorithm == AlgorithmType.READER_PREFERENCE:
            self.strategy: BaseSyncStrategy = ReaderPreferenceStrategy()
        elif config.algorithm == AlgorithmType.WRITER_PREFERENCE:
            self.strategy = WriterPreferenceStrategy()
        else:
            self.strategy = FairFIFOStrategy()

        # Shared Resource
        self.resource = SharedResource(initial_value=config.initial_value)

        # Process registry
        self.processes: Dict[str, ProcessInfo] = {}
        self.threads: List[threading.Thread] = []

        # Event log
        self._seq_counter = 0
        self.events: List[SimulationEvent] = []

        # Initialize process models
        self._init_processes()

    def _init_processes(self) -> None:
        now = time.time()
        for i in range(1, self.config.reader_count + 1):
            pid = f"R{i:02d}"
            self.processes[pid] = ProcessInfo(
                id=pid,
                process_type=ProcessType.READER,
                state=ProcessState.CREATED,
                created_at=now,
                duration_ms=float(self.config.read_duration_ms),
            )
        for j in range(1, self.config.writer_count + 1):
            pid = f"W{j:02d}"
            self.processes[pid] = ProcessInfo(
                id=pid,
                process_type=ProcessType.WRITER,
                state=ProcessState.CREATED,
                created_at=now,
                duration_ms=float(self.config.write_duration_ms),
                operation=self.config.writer_op,
                operation_amount=self.config.writer_amount,
            )

    def _emit_event(
        self,
        event_type: str,
        process_id: Optional[str] = None,
        from_state: Optional[ProcessState] = None,
        to_state: Optional[ProcessState] = None,
        details: str = "",
    ) -> SimulationEvent:
        with self._lock:
            self._seq_counter += 1
            rel_ms = (time.monotonic() - self.start_mono) * 1000.0 if self.start_mono > 0 else 0.0
            val, ver, readers, writer = self.resource.get_snapshot()
            sem = self.strategy.get_state()
            ptype = self.processes[process_id].process_type if process_id and process_id in self.processes else None

            event = SimulationEvent(
                seq=self._seq_counter,
                timestamp_rel_ms=round(rel_ms, 2),
                timestamp_iso=datetime.now(timezone.utc).isoformat(),
                process_id=process_id,
                process_type=ptype,
                event_type=event_type,
                from_state=from_state,
                to_state=to_state,
                resource_value=val,
                resource_version=ver,
                active_readers=len(readers),
                active_writers=1 if writer else 0,
                waiting_readers=sem.waiting_readers,
                waiting_writers=sem.waiting_writers,
                details=details,
            )
            self.events.append(event)

        # Notify callback if registered
        if self.event_callback:
            try:
                target_loop = None
                if self.loop and self.loop.is_running():
                    target_loop = self.loop
                else:
                    try:
                        curr_loop = asyncio.get_running_loop()
                        if curr_loop.is_running():
                            target_loop = curr_loop
                    except RuntimeError:
                        target_loop = None

                if asyncio.iscoroutinefunction(self.event_callback):
                    if target_loop:
                        asyncio.run_coroutine_threadsafe(self.event_callback(event), target_loop)
                else:
                    # Synchronous callback
                    res = self.event_callback(event)
                    if asyncio.iscoroutine(res):
                        if target_loop:
                            asyncio.run_coroutine_threadsafe(res, target_loop)
                        else:
                            res.close()
            except Exception:
                pass

        return event

    def start(self) -> None:
        with self._lock:
            if self.status == SimulationStatus.RUNNING:
                return
            self.status = SimulationStatus.RUNNING
            self.stop_event.clear()
            self.pause_event.set()
            self.pause_start_mono = 0.0
            self.total_paused_sec = 0.0
            self.start_mono = time.monotonic()

        self._emit_event("SIMULATION_STARTED", details=f"Simulation started using {self.config.algorithm.value} algorithm.")

        # Interleave reader and writer arrival threads
        processes_list = list(self.processes.values())
        # Alternating order to demonstrate contention
        readers = [p for p in processes_list if p.process_type == ProcessType.READER]
        writers = [p for p in processes_list if p.process_type == ProcessType.WRITER]

        interleaved = []
        r_idx, w_idx = 0, 0
        while r_idx < len(readers) or w_idx < len(writers):
            # Take up to 2 readers, then 1 writer
            for _ in range(2):
                if r_idx < len(readers):
                    interleaved.append(readers[r_idx])
                    r_idx += 1
            if w_idx < len(writers):
                interleaved.append(writers[w_idx])
                w_idx += 1

        # Spawn threads
        for idx, proc in enumerate(interleaved):
            delay = (idx * self.config.stagger_arrivals_ms) / 1000.0
            if proc.process_type == ProcessType.READER:
                t = threading.Thread(
                    target=self._reader_worker,
                    args=(proc.id, delay),
                    name=f"Thread-{proc.id}",
                    daemon=True,
                )
            else:
                t = threading.Thread(
                    target=self._writer_worker,
                    args=(proc.id, delay),
                    name=f"Thread-{proc.id}",
                    daemon=True,
                )
            self.threads.append(t)
            t.start()

        # Watcher thread to observe completion or timeout
        watcher = threading.Thread(target=self._supervise_run, daemon=True, name="SimulationSupervisor")
        watcher.start()

    def pause(self) -> None:
        with self._lock:
            if self.status != SimulationStatus.RUNNING:
                return
            self.status = SimulationStatus.PAUSED
            self.pause_event.clear()
            self.pause_start_mono = time.monotonic()
        self._emit_event("SIMULATION_PAUSED", details="Simulation paused. Critical sections and queued threads held safely without deadlocks.")

    def resume(self) -> None:
        with self._lock:
            if self.status != SimulationStatus.PAUSED:
                return
            self.status = SimulationStatus.RUNNING
            paused_delta = time.monotonic() - self.pause_start_mono
            self.total_paused_sec += paused_delta
            self.pause_event.set()
        self._emit_event("SIMULATION_RESUMED", details=f"Simulation resumed after {paused_delta * 1000.0:.1f}ms pause.")

    def _supervise_run(self) -> None:
        max_duration = float(self.config.max_duration_sec)
        while not self.stop_event.is_set():
            time.sleep(0.1)
            with self._lock:
                status = self.status
                start_mono = self.start_mono
                total_paused = self.total_paused_sec
                pause_start = self.pause_start_mono

            active_pause = (time.monotonic() - pause_start) if status == SimulationStatus.PAUSED else 0.0
            elapsed = (time.monotonic() - start_mono) - total_paused - active_pause if start_mono > 0 else 0.0
            if elapsed >= max_duration:
                self._emit_event("TIMEOUT", details=f"Simulation hit maximum limit of {max_duration}s.")
                self.stop()
                break

            # Check if all processes completed
            with self._lock:
                all_done = all(
                    p.state in (ProcessState.COMPLETED, ProcessState.CANCELLED, ProcessState.ERROR)
                    for p in self.processes.values()
                )
            if all_done:
                self.end_mono = time.monotonic()
                with self._lock:
                    if self.status in (SimulationStatus.RUNNING, SimulationStatus.PAUSED):
                        self.status = SimulationStatus.COMPLETED
                self._emit_event("SIMULATION_COMPLETED", details="All concurrent processes completed execution.")
                break

    def stop(self) -> None:
        with self._lock:
            if self.status in (SimulationStatus.COMPLETED, SimulationStatus.CANCELLED):
                return
            self.status = SimulationStatus.CANCELLED
            self.stop_event.set()
            self.pause_event.set()  # Unblock paused threads so they can notice stop_event
            self.end_mono = time.monotonic()

        self._emit_event("SIMULATION_STOPPED", details="Stop requested. Gracefully signalling worker threads.")

        # Mark waiting or created processes as cancelled
        with self._lock:
            for p in self.processes.values():
                if p.state in (ProcessState.CREATED, ProcessState.WAITING):
                    prev = p.state
                    p.state = ProcessState.CANCELLED
                    p.completed_at = time.time()

    def reset(self) -> None:
        self.stop()
        # Wait a moment for threads to acknowledge cancellation
        for t in self.threads:
            t.join(timeout=0.2)

        with self._lock:
            self.threads.clear()
            self.events.clear()
            self._seq_counter = 0
            self.status = SimulationStatus.IDLE
            self.stop_event.clear()
            self.pause_event.set()
            self.pause_start_mono = 0.0
            self.total_paused_sec = 0.0
            self.start_mono = 0.0
            self.end_mono = 0.0
            self.resource = SharedResource(initial_value=self.config.initial_value)

            if self.config.algorithm == AlgorithmType.READER_PREFERENCE:
                self.strategy = ReaderPreferenceStrategy()
            elif self.config.algorithm == AlgorithmType.WRITER_PREFERENCE:
                self.strategy = WriterPreferenceStrategy()
            else:
                self.strategy = FairFIFOStrategy()

            self.processes.clear()
            self._init_processes()

        self._emit_event("SIMULATION_RESET", details="Simulator reset to initial configuration.")

    def _reader_worker(self, process_id: str, arrival_delay: float) -> None:
        # 1. Arrival delay
        if arrival_delay > 0:
            delay_remaining = arrival_delay
            while delay_remaining > 0 and not self.stop_event.is_set():
                if not self.pause_event.is_set():
                    self.pause_event.wait(timeout=0.05)
                    continue
                slice_time = min(0.05, delay_remaining)
                if self.stop_event.wait(timeout=slice_time):
                    break
                delay_remaining -= slice_time

        if self.stop_event.is_set():
            with self._lock:
                self.processes[process_id].state = ProcessState.CANCELLED
            return

        # 2. Enter WAITING state
        with self._lock:
            p = self.processes[process_id]
            prev_state = p.state
            p.state = ProcessState.WAITING
            p.requested_at = time.monotonic()
        self._emit_event("PROCESS_REQUESTED", process_id=process_id, from_state=prev_state, to_state=ProcessState.WAITING, details=f"Reader {process_id} queued and requested read lease.")

        # 3. Acquire synchronization entry
        admitted = self.strategy.reader_enter(self.stop_event, self.pause_event)
        if not admitted or self.stop_event.is_set():
            with self._lock:
                self.processes[process_id].state = ProcessState.CANCELLED
                self.processes[process_id].completed_at = time.time()
            self._emit_event("PROCESS_CANCELLED", process_id=process_id, from_state=ProcessState.WAITING, to_state=ProcessState.CANCELLED, details=f"Reader {process_id} was cancelled while waiting.")
            return

        # 4. Enter READING state
        admit_time = time.monotonic()
        with self._lock:
            p = self.processes[process_id]
            p.admitted_at = admit_time
            p.wait_time_ms = round((admit_time - (p.requested_at or admit_time)) * 1000.0, 2)
            p.state = ProcessState.READING

        # Enter resource read lease
        self.resource.enter_read(process_id)
        val, ver = self.resource.read_value(process_id)
        self._emit_event("READ_ACQUIRED", process_id=process_id, from_state=ProcessState.WAITING, to_state=ProcessState.READING, details=f"Reader {process_id} admitted (wait: {p.wait_time_ms}ms). Read current value={val}, ver={ver}.")

        # 5. Execute read duration with cooperative pause & progress tracking
        read_time_sec = self.config.read_duration_ms / 1000.0
        steps = 10
        step_duration = read_time_sec / steps
        step = 1
        while step <= steps and not self.stop_event.is_set():
            if not self.pause_event.is_set():
                self.pause_event.wait(timeout=0.02)
                continue
            # Responsive sub-slice wait
            slice_end = time.monotonic() + step_duration
            stopped = False
            paused = False
            while time.monotonic() < slice_end and not stopped and not paused:
                wait_slice = min(0.02, max(0.001, slice_end - time.monotonic()))
                if self.stop_event.wait(timeout=wait_slice):
                    stopped = True
                    break
                if not self.pause_event.is_set():
                    paused = True
                    break

            if stopped:
                break
            if paused:
                continue

            with self._lock:
                self.processes[process_id].progress_pct = round((step / steps) * 100.0, 1)
            step += 1

        # 6. Exit resource and synchronization
        self.resource.exit_read(process_id)
        self.strategy.reader_exit()

        comp_time = time.monotonic()
        with self._lock:
            p = self.processes[process_id]
            p.state = ProcessState.COMPLETED
            p.completed_at = time.time()
            p.duration_ms = round((comp_time - admit_time) * 1000.0, 2)
            p.progress_pct = 100.0

        self._emit_event("READ_RELEASED", process_id=process_id, from_state=ProcessState.READING, to_state=ProcessState.COMPLETED, details=f"Reader {process_id} released read lease after {p.duration_ms}ms.")

    def _writer_worker(self, process_id: str, arrival_delay: float) -> None:
        # 1. Arrival delay
        if arrival_delay > 0:
            delay_remaining = arrival_delay
            while delay_remaining > 0 and not self.stop_event.is_set():
                if not self.pause_event.is_set():
                    self.pause_event.wait(timeout=0.05)
                    continue
                slice_time = min(0.05, delay_remaining)
                if self.stop_event.wait(timeout=slice_time):
                    break
                delay_remaining -= slice_time

        if self.stop_event.is_set():
            with self._lock:
                self.processes[process_id].state = ProcessState.CANCELLED
            return

        # 2. Enter WAITING state
        with self._lock:
            p = self.processes[process_id]
            prev_state = p.state
            p.state = ProcessState.WAITING
            p.requested_at = time.monotonic()
        self._emit_event("PROCESS_REQUESTED", process_id=process_id, from_state=prev_state, to_state=ProcessState.WAITING, details=f"Writer {process_id} queued for exclusive write lease.")

        # 3. Acquire synchronization entry
        admitted = self.strategy.writer_enter(self.stop_event, self.pause_event)
        if not admitted or self.stop_event.is_set():
            with self._lock:
                self.processes[process_id].state = ProcessState.CANCELLED
                self.processes[process_id].completed_at = time.time()
            self._emit_event("PROCESS_CANCELLED", process_id=process_id, from_state=ProcessState.WAITING, to_state=ProcessState.CANCELLED, details=f"Writer {process_id} was cancelled while waiting.")
            return

        # 4. Enter WRITING state
        admit_time = time.monotonic()
        with self._lock:
            p = self.processes[process_id]
            p.admitted_at = admit_time
            p.wait_time_ms = round((admit_time - (p.requested_at or admit_time)) * 1000.0, 2)
            p.state = ProcessState.WRITING

        # Enter resource exclusive write lease
        self.resource.enter_write(process_id)
        self._emit_event("WRITE_ACQUIRED", process_id=process_id, from_state=ProcessState.WAITING, to_state=ProcessState.WRITING, details=f"Writer {process_id} acquired exclusive lock (wait: {p.wait_time_ms}ms).")

        # 5. Execute write duration with cooperative pause & progress tracking
        write_time_sec = self.config.write_duration_ms / 1000.0
        steps = 10
        step_duration = write_time_sec / steps
        step = 1
        while step <= steps and not self.stop_event.is_set():
            if not self.pause_event.is_set():
                self.pause_event.wait(timeout=0.02)
                continue
            # Responsive sub-slice wait
            slice_end = time.monotonic() + step_duration
            stopped = False
            paused = False
            while time.monotonic() < slice_end and not stopped and not paused:
                wait_slice = min(0.02, max(0.001, slice_end - time.monotonic()))
                if self.stop_event.wait(timeout=wait_slice):
                    stopped = True
                    break
                if not self.pause_event.is_set():
                    paused = True
                    break

            if stopped:
                break
            if paused:
                continue

            with self._lock:
                self.processes[process_id].progress_pct = round((step / steps) * 100.0, 1)
            step += 1

        # Mutate resource at commit time
        new_val, new_ver = self.resource.execute_write(
            process_id,
            self.config.writer_op,
            self.config.writer_amount,
        )

        # 6. Exit resource and synchronization
        self.resource.exit_write(process_id)
        self.strategy.writer_exit()

        comp_time = time.monotonic()
        with self._lock:
            p = self.processes[process_id]
            p.state = ProcessState.COMPLETED
            p.completed_at = time.time()
            p.duration_ms = round((comp_time - admit_time) * 1000.0, 2)
            p.progress_pct = 100.0

        self._emit_event("WRITE_COMMITTED", process_id=process_id, from_state=ProcessState.WRITING, to_state=ProcessState.COMPLETED, details=f"Writer {process_id} committed {self.config.writer_op.value} {self.config.writer_amount} -> val={new_val}, ver={new_ver} after {p.duration_ms}ms.")

    def get_metrics(self) -> SimulationMetrics:
        with self._lock:
            status = self.status
            start_m = self.start_mono
            total_p = self.total_paused_sec
            p_start = self.pause_start_mono

            active_pause = (time.monotonic() - p_start) if status == SimulationStatus.PAUSED else 0.0
            effective_elapsed = (time.monotonic() - start_m) - total_p - active_pause if start_m > 0 else 0.001
            elapsed_sec = max(0.001, effective_elapsed)

            readers = [p for p in self.processes.values() if p.process_type == ProcessType.READER]
            writers = [p for p in self.processes.values() if p.process_type == ProcessType.WRITER]

            completed_reads = [p for p in readers if p.state == ProcessState.COMPLETED]
            completed_writes = [p for p in writers if p.state == ProcessState.COMPLETED]

            reader_waits = [p.wait_time_ms for p in completed_reads]
            writer_waits = [p.wait_time_ms for p in completed_writes]

            avg_r_wait = (sum(reader_waits) / len(reader_waits)) if reader_waits else 0.0
            avg_w_wait = (sum(writer_waits) / len(writer_waits)) if writer_waits else 0.0

            max_r_wait = max(reader_waits) if reader_waits else 0.0
            max_w_wait = max(writer_waits) if writer_waits else 0.0

            total_ops = len(completed_reads) + len(completed_writes)
            throughput = (total_ops / elapsed_sec) if elapsed_sec > 0.1 else 0.0

            occupancy = self.resource.get_occupancy_ratio(elapsed_sec)

            # Starvation warning heuristic:
            # If any completed process or still-waiting process waited > 3x average of the other type
            starvation = False
            details = None
            if avg_r_wait > 0 and max_w_wait > (avg_r_wait * 3.5) and len(completed_reads) >= 3:
                starvation = True
                details = f"Writers experienced prolonged starvation ({max_w_wait:.1f}ms max wait vs {avg_r_wait:.1f}ms reader avg)."
            elif avg_w_wait > 0 and max_r_wait > (avg_w_wait * 3.5) and len(completed_writes) >= 2:
                starvation = True
                details = f"Readers experienced prolonged starvation ({max_r_wait:.1f}ms max wait vs {avg_w_wait:.1f}ms writer avg)."

            return SimulationMetrics(
                total_readers=len(readers),
                total_writers=len(writers),
                completed_reads=len(completed_reads),
                completed_writes=len(completed_writes),
                avg_reader_wait_ms=round(avg_r_wait, 2),
                avg_writer_wait_ms=round(avg_w_wait, 2),
                max_reader_wait_ms=round(max_r_wait, 2),
                max_writer_wait_ms=round(max_w_wait, 2),
                total_elapsed_ms=round(elapsed_sec * 1000.0, 2),
                throughput_ops_per_sec=round(throughput, 2),
                resource_occupancy_pct=round(occupancy, 2),
                starvation_warning=starvation,
                starvation_details=details,
            )

    def get_state(self) -> SimulationStateResponse:
        with self._lock:
            val, ver, active_readers, active_writer = self.resource.get_snapshot()
            sem = self.strategy.get_state()
            procs = [p.model_copy() for p in self.processes.values()]
            evs = self.events[-30:]  # Recent 30 events for compact overview
            tot_evs = len(self.events)

        metrics = self.get_metrics()
        occupancy_str = "IDLE"
        if active_writer:
            occupancy_str = f"EXCLUSIVE WRITE ({active_writer})"
        elif active_readers:
            occupancy_str = f"SHARED READ ({len(active_readers)} readers)"

        return SimulationStateResponse(
            simulation_id=self.simulation_id,
            status=self.status,
            algorithm=self.config.algorithm,
            config=self.config,
            resource_value=val,
            resource_version=ver,
            resource_occupancy=occupancy_str,
            active_reader_ids=list(active_readers),
            active_writer_id=active_writer,
            processes=procs,
            semaphores=sem,
            metrics=metrics,
            recent_events=evs,
            total_events=tot_evs,
        )

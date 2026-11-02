import time
import threading
import pytest
from app.sync.models import (
    AlgorithmType,
    ProcessState,
    ProcessType,
    SimulationConfig,
    WriterOperation,
)
from app.sync.resource import SharedResource, InvariantViolationError
from app.sync.algorithms import (
    ReaderPreferenceStrategy,
    WriterPreferenceStrategy,
    FairFIFOStrategy,
)
from app.sync.engine import SimulationEngine


def test_shared_resource_invariants():
    """Verify safety assertions in SharedResource."""
    res = SharedResource(initial_value=50)

    # Invariant 1: Cannot read while writer is active
    res.enter_write("W01")
    with pytest.raises(InvariantViolationError):
        res.enter_read("R01")
    res.exit_write("W01")

    # Invariant 2: Cannot write while readers are active
    res.enter_read("R01")
    with pytest.raises(InvariantViolationError):
        res.enter_write("W01")
    res.exit_read("R01")

    # Invariant 3: Single writer exclusivity
    res.enter_write("W01")
    with pytest.raises(InvariantViolationError):
        res.enter_write("W02")
    res.exit_write("W01")

    # Invariant 4: Monotonic versioning on write mutations
    res.enter_write("W01")
    val, ver = res.execute_write("W01", WriterOperation.ADD, 25)
    assert val == 75
    assert ver == 1
    res.exit_write("W01")

    res.enter_write("W02")
    val, ver = res.execute_write("W02", WriterOperation.MULTIPLY, 2)
    assert val == 150
    assert ver == 2
    res.exit_write("W02")


def test_concurrent_readers_allowed():
    """Verify multiple readers can hold the lock simultaneously."""
    strategy = ReaderPreferenceStrategy()
    stop_event = threading.Event()

    assert strategy.reader_enter(stop_event) is True
    assert strategy.reader_enter(stop_event) is True
    assert strategy.reader_enter(stop_event) is True
    assert strategy.read_count == 3

    strategy.reader_exit()
    strategy.reader_exit()
    strategy.reader_exit()
    assert strategy.read_count == 0


def test_reader_preference_writer_waits():
    """Verify writer cannot enter while reader preference has active readers."""
    strategy = ReaderPreferenceStrategy()
    stop_event = threading.Event()

    # Reader enters
    assert strategy.reader_enter(stop_event) is True
    assert strategy.read_count == 1

    # Writer try enter in thread
    writer_entered = threading.Event()

    def writer_task():
        if strategy.writer_enter(stop_event):
            writer_entered.set()
            strategy.writer_exit()

    t = threading.Thread(target=writer_task, daemon=True)
    t.start()

    # Wait briefly; writer should be blocked
    assert not writer_entered.wait(timeout=0.3)
    assert strategy.waiting_writers == 1

    # Now reader exits; writer should immediately enter
    strategy.reader_exit()
    assert writer_entered.wait(timeout=1.0)
    t.join(timeout=0.5)


def test_writer_preference_blocks_incoming_readers():
    """Verify in Writer Preference, a waiting writer prevents new readers from entering."""
    strategy = WriterPreferenceStrategy()
    stop_event = threading.Event()

    # Initial reader enters
    assert strategy.reader_enter(stop_event) is True
    assert strategy.read_count == 1

    # Writer arrives and queues
    writer_entered = threading.Event()

    def writer_task():
        if strategy.writer_enter(stop_event):
            writer_entered.set()
            strategy.writer_exit()

    tw = threading.Thread(target=writer_task, daemon=True)
    tw.start()
    time.sleep(0.1)
    assert strategy.write_count >= 1

    # New reader tries to enter while writer is waiting
    reader2_entered = threading.Event()

    def reader2_task():
        if strategy.reader_enter(stop_event):
            reader2_entered.set()
            strategy.reader_exit()

    tr2 = threading.Thread(target=reader2_task, daemon=True)
    tr2.start()

    # Reader 2 MUST be blocked by read_try because writer is waiting!
    assert not reader2_entered.wait(timeout=0.3)

    # First reader exits -> Writer should enter before Reader 2
    strategy.reader_exit()
    assert writer_entered.wait(timeout=1.0)

    # Now after writer exits, reader 2 is admitted
    assert reader2_entered.wait(timeout=1.0)

    tw.join(timeout=0.5)
    tr2.join(timeout=0.5)


def test_fair_fifo_ordering():
    """Verify FIFO turnstile preserves request ordering."""
    strategy = FairFIFOStrategy()
    stop_event = threading.Event()

    execution_order = []

    # First reader claims resource
    assert strategy.reader_enter(stop_event) is True
    execution_order.append("R1_ENTER")

    # Writer queues next
    def writer_task():
        if strategy.writer_enter(stop_event):
            execution_order.append("W1_ENTER")
            time.sleep(0.05)
            strategy.writer_exit()
            execution_order.append("W1_EXIT")

    tw = threading.Thread(target=writer_task, daemon=True)
    tw.start()
    time.sleep(0.1)

    # Reader 2 queues after Writer
    def reader2_task():
        if strategy.reader_enter(stop_event):
            execution_order.append("R2_ENTER")
            strategy.reader_exit()
            execution_order.append("R2_EXIT")

    tr2 = threading.Thread(target=reader2_task, daemon=True)
    tr2.start()
    time.sleep(0.1)

    # Release R1
    strategy.reader_exit()
    execution_order.append("R1_EXIT")

    tw.join(timeout=1.0)
    tr2.join(timeout=1.0)

    # Verify W1 must enter before R2
    w1_enter_idx = execution_order.index("W1_ENTER")
    r2_enter_idx = execution_order.index("R2_ENTER")
    assert w1_enter_idx < r2_enter_idx, f"FIFO ordering violated: {execution_order}"


def test_simulation_engine_full_run():
    """Verify full end-to-end execution of the simulation engine with real threads."""
    config = SimulationConfig(
        algorithm=AlgorithmType.READER_PREFERENCE,
        reader_count=3,
        writer_count=1,
        read_duration_ms=200,
        write_duration_ms=300,
        initial_value=100,
        writer_op=WriterOperation.ADD,
        writer_amount=50,
        max_duration_sec=10,
        stagger_arrivals_ms=50,
    )

    events = []
    engine = SimulationEngine(config, event_callback=lambda e: events.append(e))
    engine.start()

    # Wait for completion
    timeout = 10.0
    start = time.time()
    while engine.status.value == "RUNNING" and (time.time() - start) < timeout:
        time.sleep(0.1)

    assert engine.status.value == "COMPLETED"
    state = engine.get_state()

    assert state.resource_value == 150
    assert state.resource_version == 1
    assert state.metrics.completed_reads == 3
    assert state.metrics.completed_writes == 1
    assert state.metrics.throughput_ops_per_sec > 0
    assert len(events) >= 8


def test_simulation_clean_cancellation():
    """Verify stopping an active simulation terminates all threads cleanly."""
    config = SimulationConfig(
        algorithm=AlgorithmType.FAIR_FIFO,
        reader_count=5,
        writer_count=3,
        read_duration_ms=2000,
        write_duration_ms=2000,
        initial_value=100,
        max_duration_sec=30,
    )

    engine = SimulationEngine(config)
    engine.start()
    time.sleep(0.3)

    assert engine.status.value == "RUNNING"
    engine.stop()

    assert engine.status.value == "CANCELLED"
    time.sleep(0.2)

    # Verify all threads terminate without hang
    for t in engine.threads:
        assert not t.is_alive() or t.join(timeout=0.5) is None


def test_simulation_pause_resume():
    """Verify cooperative mid-flight pause and resume without deadlock or invariant violations."""
    config = SimulationConfig(
        algorithm=AlgorithmType.FAIR_FIFO,
        reader_count=2,
        writer_count=1,
        read_duration_ms=500,
        write_duration_ms=500,
        initial_value=100,
        writer_op=WriterOperation.ADD,
        writer_amount=25,
        max_duration_sec=15,
        stagger_arrivals_ms=100,
    )

    engine = SimulationEngine(config)
    engine.start()
    time.sleep(0.15)
    assert engine.status.value == "RUNNING"

    # Pause mid-execution
    engine.pause()
    assert engine.status.value == "PAUSED"
    assert not engine.pause_event.is_set()
    time.sleep(0.05)  # Allow worker thread slice to enter pause wait

    # Capture progress snapshot while paused
    state_paused_1 = engine.get_state()
    active_procs = [p for p in state_paused_1.processes if p.state in (ProcessState.READING, ProcessState.WRITING)]
    time.sleep(0.3)
    state_paused_2 = engine.get_state()

    # While paused, no active process should advance progress
    for p1 in active_procs:
        p2 = next(p for p in state_paused_2.processes if p.id == p1.id)
        assert p2.progress_pct == p1.progress_pct

    # Resume execution
    engine.resume()
    assert engine.status.value == "RUNNING"
    assert engine.pause_event.is_set()

    # Wait for completion
    timeout = 10.0
    start = time.time()
    while engine.status.value == "RUNNING" and (time.time() - start) < timeout:
        time.sleep(0.1)

    assert engine.status.value == "COMPLETED"
    final_state = engine.get_state()
    assert final_state.resource_value == 125
    assert final_state.resource_version == 1
    assert final_state.metrics.completed_reads == 2
    assert final_state.metrics.completed_writes == 1
    assert engine.total_paused_sec >= 0.25



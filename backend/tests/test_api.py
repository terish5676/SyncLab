import pytest
import asyncio
from app.main import (
    health_check,
    create_simulation,
    start_simulation,
    pause_simulation,
    resume_simulation,
    stop_simulation,
    reset_simulation,
    get_simulation_state,
    get_events,
    export_events,
)
from app.sync.models import SimulationConfig, SimulationStatus

@pytest.mark.asyncio
async def test_health_check():
    res = await health_check()
    assert res["status"] == "ok"
    assert "service" in res

@pytest.mark.asyncio
async def test_simulation_lifecycle():
    # 1. Create
    cfg = SimulationConfig(
        algorithm="reader_preference",
        reader_count=3,
        writer_count=1,
        read_duration_ms=200,
        write_duration_ms=200,
        initial_value=100,
        writer_op="ADD",
        writer_amount=10,
        max_duration_sec=5,
        stagger_arrivals_ms=20,
    )
    state = await create_simulation(cfg)
    assert state.status == SimulationStatus.IDLE
    assert len(state.processes) == 4

    # 2. State
    state_get = await get_simulation_state()
    assert state_get.status == SimulationStatus.IDLE

    # 3. Start
    state_start = await start_simulation()
    assert state_start.status == SimulationStatus.RUNNING

    # 3b. Pause
    state_pause = await pause_simulation()
    assert state_pause.status == SimulationStatus.PAUSED

    # 3c. Resume
    state_resume = await resume_simulation()
    assert state_resume.status == SimulationStatus.RUNNING

    # 4. Stop
    state_stop = await stop_simulation()
    assert state_stop.status == SimulationStatus.CANCELLED

    # 5. Reset
    state_reset = await reset_simulation()
    assert state_reset.status == SimulationStatus.IDLE
    await asyncio.sleep(0.05)

@pytest.mark.asyncio
async def test_events_and_export():
    cfg = SimulationConfig(
        reader_count=2,
        writer_count=1,
        read_duration_ms=100,
        write_duration_ms=100,
    )
    await create_simulation(cfg)
    await start_simulation()
    await asyncio.sleep(0.3)
    await stop_simulation()

    events = await get_events(limit=50)
    assert isinstance(events, list)
    assert len(events) > 0

    csv_res = await export_events(format="csv")
    assert "text/csv" in csv_res.media_type
    await asyncio.sleep(0.05)

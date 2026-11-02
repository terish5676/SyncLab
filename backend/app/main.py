import asyncio
import csv
import io
import json
import time
from typing import Annotated, List, Optional, Set
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse

from app.sync.models import (
    AlgorithmType,
    ProcessType,
    SimulationConfig,
    SimulationEvent,
    SimulationStateResponse,
    SimulationMetrics,
    SimulationStatus,
)
from app.sync.engine import SimulationEngine

app = FastAPI(
    title="SyncLab API",
    description="Real-time Reader-Writer Synchronization Simulator Backend",
    version="1.0.0",
)

# Allow frontend cross-origin requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ConnectionManager:
    """Manages active WebSocket connections with reconnect event replay."""
    def __init__(self):
        self.active_connections: Set[WebSocket] = set()

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.add(websocket)

    def disconnect(self, websocket: WebSocket):
        self.active_connections.discard(websocket)

    async def broadcast_event(self, event: SimulationEvent):
        if not self.active_connections:
            return
        payload = event.model_dump_json()
        disconnected = []
        for connection in list(self.active_connections):
            try:
                await connection.send_text(payload)
            except Exception:
                disconnected.append(connection)
        for dead in disconnected:
            self.active_connections.discard(dead)

manager = ConnectionManager()

# Global engine instance
current_engine: Optional[SimulationEngine] = None
_engine_lock: Optional[asyncio.Lock] = None

def get_engine_lock() -> asyncio.Lock:
    global _engine_lock
    if _engine_lock is None:
        _engine_lock = asyncio.Lock()
    return _engine_lock

async def on_engine_event(event: SimulationEvent):
    await manager.broadcast_event(event)

def get_or_create_engine(config: Optional[SimulationConfig] = None) -> SimulationEngine:
    global current_engine
    if current_engine is None or config is not None:
        cfg = config or SimulationConfig()
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
        current_engine = SimulationEngine(cfg, event_callback=on_engine_event, loop=loop)
    return current_engine


@app.get("/api/health")
async def health_check():
    return {
        "status": "ok",
        "service": "SyncLab Simulator Backend",
        "timestamp": time.time(),
        "active_websockets": len(manager.active_connections),
    }


@app.post("/api/simulation/create", response_model=SimulationStateResponse)
async def create_simulation(config: SimulationConfig):
    async with get_engine_lock():
        global current_engine
        if current_engine and current_engine.status == SimulationStatus.RUNNING:
            current_engine.stop()
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None
        current_engine = SimulationEngine(config, event_callback=on_engine_event, loop=loop)
        return current_engine.get_state()


@app.post("/api/simulation/start", response_model=SimulationStateResponse)
async def start_simulation():
    async with get_engine_lock():
        engine = get_or_create_engine()
        if engine.status in (SimulationStatus.COMPLETED, SimulationStatus.CANCELLED):
            engine.reset()
        engine.start()
        return engine.get_state()


@app.post("/api/simulation/pause", response_model=SimulationStateResponse)
async def pause_simulation():
    async with get_engine_lock():
        engine = get_or_create_engine()
        engine.pause()
        return engine.get_state()


@app.post("/api/simulation/resume", response_model=SimulationStateResponse)
async def resume_simulation():
    async with get_engine_lock():
        engine = get_or_create_engine()
        engine.resume()
        return engine.get_state()


@app.post("/api/simulation/stop", response_model=SimulationStateResponse)
async def stop_simulation():
    async with get_engine_lock():
        engine = get_or_create_engine()
        engine.stop()
        return engine.get_state()


@app.post("/api/simulation/reset", response_model=SimulationStateResponse)
async def reset_simulation():
    async with get_engine_lock():
        engine = get_or_create_engine()
        engine.reset()
        return engine.get_state()


@app.get("/api/simulation/state", response_model=SimulationStateResponse)
async def get_simulation_state():
    engine = get_or_create_engine()
    return engine.get_state()


@app.get("/api/simulation/events", response_model=List[SimulationEvent])
async def get_events(
    min_seq: Annotated[int, Query(ge=0)] = 0,
    event_type: Annotated[Optional[str], Query()] = None,
    process_type: Annotated[Optional[ProcessType], Query()] = None,
    limit: Annotated[int, Query(ge=1, le=2000)] = 500,
):
    if not isinstance(min_seq, int):
        min_seq = 0
    if not isinstance(limit, int):
        limit = 500
    engine = get_or_create_engine()
    with engine._lock:
        evs = engine.events[:]

    filtered = [
        e for e in evs
        if e.seq > min_seq
        and (event_type is None or e.event_type == event_type)
        and (process_type is None or e.process_type == process_type)
    ]
    return filtered[:limit]


@app.get("/api/simulation/events/export")
async def export_events(format: Annotated[str, Query(pattern="^(csv|json)$")] = "csv"):
    if not isinstance(format, str):
        format = "csv"
    engine = get_or_create_engine()
    with engine._lock:
        evs = [e.model_dump() for e in engine.events]

    if format == "json":
        return JSONResponse(
            content=evs,
            headers={"Content-Disposition": f"attachment; filename=synclab-events-{engine.simulation_id}.json"},
        )

    # Format as CSV
    output = io.StringIO()
    if evs:
        fieldnames = list(evs[0].keys())
        writer = csv.DictWriter(output, fieldnames=fieldnames)
        writer.writeheader()
        for ev in evs:
            writer.writerow(ev)
    else:
        output.write("seq,timestamp_rel_ms,event_type,process_id,details\n")

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=synclab-events-{engine.simulation_id}.csv"},
    )


@app.get("/api/simulation/results")
async def get_results():
    engine = get_or_create_engine()
    state = engine.get_state()
    return {
        "simulation_id": engine.simulation_id,
        "status": state.status,
        "algorithm": state.algorithm,
        "config": state.config.model_dump(),
        "final_resource_value": state.resource_value,
        "final_resource_version": state.resource_version,
        "metrics": state.metrics.model_dump(),
        "processes": [p.model_dump() for p in state.processes],
        "total_events": state.total_events,
    }


@app.post("/api/simulation/compare")
async def compare_algorithms(config: SimulationConfig):
    """
    Executes identical workloads against Reader Preference, Writer Preference,
    and Fair FIFO to yield verifiable comparative metrics.
    """
    results = {}
    algorithms = [
        AlgorithmType.READER_PREFERENCE,
        AlgorithmType.WRITER_PREFERENCE,
        AlgorithmType.FAIR_FIFO,
    ]

    for algo in algorithms:
        cfg = config.model_copy(update={"algorithm": algo})
        # Use a localized engine for isolated evaluation
        test_engine = SimulationEngine(cfg)
        test_engine.start()

        # Await completion
        max_wait = float(cfg.max_duration_sec)
        start_t = time.monotonic()
        while test_engine.status == SimulationStatus.RUNNING and (time.monotonic() - start_t) < max_wait:
            await asyncio.sleep(0.05)

        results[algo.value] = {
            "algorithm": algo.value,
            "metrics": test_engine.get_metrics().model_dump(),
            "final_value": test_engine.resource.get_snapshot()[0],
            "final_version": test_engine.resource.get_snapshot()[1],
            "total_events": len(test_engine.events),
        }

    return {
        "workload": config.model_dump(),
        "comparison": results,
        "summary": "Comparison benchmark completed using identical concurrency workload.",
    }


@app.websocket("/ws/events")
async def websocket_events_endpoint(
    websocket: WebSocket,
    last_seq: Annotated[int, Query(ge=0)] = 0,
):
    if not isinstance(last_seq, int):
        last_seq = 0
    await manager.connect(websocket)
    engine = get_or_create_engine()

    try:
        # 1. Send initial state snapshot
        state = engine.get_state()
        await websocket.send_text(json.dumps({
            "type": "SNAPSHOT",
            "state": state.model_dump()
        }))

        # 2. Replay any missed events since last_seq (for seamless reconnect recovery)
        with engine._lock:
            missed = [e for e in engine.events if e.seq > last_seq]

        for ev in missed:
            await websocket.send_text(ev.model_dump_json())

        # 3. Listen for client pings or commands
        while True:
            data = await websocket.receive_text()
            try:
                msg = json.loads(data)
                if msg.get("type") == "PING":
                    await websocket.send_text(json.dumps({"type": "PONG", "timestamp": time.time()}))
            except Exception:
                pass
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)


# Mount built frontend SPA if available
import os
from fastapi.staticfiles import StaticFiles

frontend_dist = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../frontend/dist"))
if os.path.exists(frontend_dist) and os.environ.get("ENV") != "test":
    app.mount("/", StaticFiles(directory=frontend_dist, html=True), name="static")


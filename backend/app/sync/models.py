from enum import Enum
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field
import time

class ProcessType(str, Enum):
    READER = "READER"
    WRITER = "WRITER"

class ProcessState(str, Enum):
    CREATED = "CREATED"
    WAITING = "WAITING"
    READING = "READING"
    WRITING = "WRITING"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"
    ERROR = "ERROR"

class AlgorithmType(str, Enum):
    READER_PREFERENCE = "reader_preference"
    WRITER_PREFERENCE = "writer_preference"
    FAIR_FIFO = "fair_fifo"

class WriterOperation(str, Enum):
    ADD = "ADD"
    SUBTRACT = "SUBTRACT"
    MULTIPLY = "MULTIPLY"
    SET = "SET"

class ProcessInfo(BaseModel):
    id: str
    process_type: ProcessType
    state: ProcessState
    created_at: float
    requested_at: Optional[float] = None
    admitted_at: Optional[float] = None
    completed_at: Optional[float] = None
    wait_time_ms: float = 0.0
    duration_ms: float = 0.0
    progress_pct: float = 0.0
    operation: Optional[WriterOperation] = None
    operation_amount: Optional[int] = None
    error: Optional[str] = None

class SimulationEvent(BaseModel):
    seq: int
    timestamp_rel_ms: float
    timestamp_iso: str
    process_id: Optional[str] = None
    process_type: Optional[ProcessType] = None
    event_type: str
    from_state: Optional[ProcessState] = None
    to_state: Optional[ProcessState] = None
    resource_value: int
    resource_version: int
    active_readers: int
    active_writers: int
    waiting_readers: int
    waiting_writers: int
    details: str

class SemaphoreState(BaseModel):
    read_count: int = 0
    write_count: int = 0
    waiting_readers: int = 0
    waiting_writers: int = 0
    resource_locked: bool = False
    read_try_locked: bool = False
    turnstile_busy: bool = False
    admission_policy: str = ""

class SimulationConfig(BaseModel):
    algorithm: AlgorithmType = AlgorithmType.READER_PREFERENCE
    reader_count: int = Field(default=6, ge=1, le=100)
    writer_count: int = Field(default=2, ge=1, le=50)
    read_duration_ms: int = Field(default=1200, ge=100, le=10000)
    write_duration_ms: int = Field(default=1800, ge=100, le=10000)
    initial_value: int = Field(default=100, ge=-10000, le=10000)
    writer_op: WriterOperation = WriterOperation.ADD
    writer_amount: int = Field(default=10, ge=1, le=1000)
    max_duration_sec: int = Field(default=60, ge=5, le=300)
    stagger_arrivals_ms: int = Field(default=200, ge=0, le=2000)

class SimulationStatus(str, Enum):
    IDLE = "IDLE"
    RUNNING = "RUNNING"
    PAUSED = "PAUSED"
    COMPLETED = "COMPLETED"
    CANCELLED = "CANCELLED"
    ERROR = "ERROR"

class SimulationMetrics(BaseModel):
    total_readers: int = 0
    total_writers: int = 0
    completed_reads: int = 0
    completed_writes: int = 0
    avg_reader_wait_ms: float = 0.0
    avg_writer_wait_ms: float = 0.0
    max_reader_wait_ms: float = 0.0
    max_writer_wait_ms: float = 0.0
    total_elapsed_ms: float = 0.0
    throughput_ops_per_sec: float = 0.0
    resource_occupancy_pct: float = 0.0
    starvation_warning: bool = False
    starvation_details: Optional[str] = None

class SimulationStateResponse(BaseModel):
    simulation_id: str
    status: SimulationStatus
    algorithm: AlgorithmType
    config: SimulationConfig
    resource_value: int
    resource_version: int
    resource_occupancy: str
    active_reader_ids: List[str]
    active_writer_id: Optional[str]
    processes: List[ProcessInfo]
    semaphores: SemaphoreState
    metrics: SimulationMetrics
    recent_events: List[SimulationEvent]
    total_events: int


export type ProcessType = 'READER' | 'WRITER';
export type ProcessState = 'CREATED' | 'WAITING' | 'READING' | 'WRITING' | 'COMPLETED' | 'CANCELLED' | 'ERROR';
export type AlgorithmType = 'reader_preference' | 'writer_preference' | 'fair_fifo';
export type WriterOp = 'ADD' | 'SUBTRACT' | 'MULTIPLY' | 'SET';
export type SimStatus = 'IDLE' | 'RUNNING' | 'PAUSED' | 'COMPLETED' | 'CANCELLED' | 'ERROR';

export interface ProcessInfo {
  id: string;
  process_type: ProcessType;
  state: ProcessState;
  created_at: number;
  requested_at: number | null;
  admitted_at: number | null;
  completed_at: number | null;
  wait_time_ms: number;
  duration_ms: number;
  progress_pct: number;
  operation: WriterOp | null;
  operation_amount: number | null;
  error: string | null;
}

export interface SimEvent {
  seq: number;
  timestamp_rel_ms: number;
  timestamp_iso: string;
  process_id: string | null;
  process_type: ProcessType | null;
  event_type: string;
  from_state: ProcessState | null;
  to_state: ProcessState | null;
  resource_value: number;
  resource_version: number;
  active_readers: number;
  active_writers: number;
  waiting_readers: number;
  waiting_writers: number;
  details: string;
}

export interface SemaphoreState {
  read_count: number;
  write_count: number;
  waiting_readers: number;
  waiting_writers: number;
  resource_locked: boolean;
  read_try_locked: boolean;
  turnstile_busy: boolean;
  admission_policy: string;
}

export interface SimConfig {
  algorithm: AlgorithmType;
  reader_count: number;
  writer_count: number;
  read_duration_ms: number;
  write_duration_ms: number;
  initial_value: number;
  writer_op: WriterOp;
  writer_amount: number;
  max_duration_sec: number;
  stagger_arrivals_ms: number;
}

export interface Metrics {
  total_readers: number;
  total_writers: number;
  completed_reads: number;
  completed_writes: number;
  avg_reader_wait_ms: number;
  avg_writer_wait_ms: number;
  max_reader_wait_ms: number;
  max_writer_wait_ms: number;
  total_elapsed_ms: number;
  throughput_ops_per_sec: number;
  resource_occupancy_pct: number;
  starvation_warning: boolean;
  starvation_details: string | null;
}

export interface SimState {
  simulation_id: string;
  status: SimStatus;
  algorithm: AlgorithmType;
  config: SimConfig;
  resource_value: number;
  resource_version: number;
  resource_occupancy: string;
  active_reader_ids: string[];
  active_writer_id: string | null;
  processes: ProcessInfo[];
  semaphores: SemaphoreState;
  metrics: Metrics;
  recent_events: SimEvent[];
  total_events: number;
  started_at: number | null;
  finished_at: number | null;
}

export interface CompareEntry {
  algorithm: AlgorithmType;
  metrics: Metrics;
  final_value: number;
  final_version: number;
  total_events: number;
}
export interface CompareResponse {
  workload: SimConfig;
  comparison: Record<AlgorithmType, CompareEntry>;
  summary: string;
}

export type ViewId = 'lab' | 'trace' | 'versus' | 'report' | 'learn';
export type ConnState = 'connecting' | 'live' | 'retrying' | 'offline';

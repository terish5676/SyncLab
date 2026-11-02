import type { CompareResponse, SimConfig, SimEvent, SimState } from './types';

const BASE: string = (import.meta.env.VITE_API_BASE as string | undefined) ?? '';

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function describeDetail(detail: unknown): string {
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    return detail
      .map((d: { loc?: (string | number)[]; msg?: string }) => {
        const field = d.loc ? d.loc.filter((x) => x !== 'body').join('.') : '';
        return field ? `${field}: ${d.msg}` : (d.msg ?? 'invalid value');
      })
      .join('; ');
  }
  return 'Request failed';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError('Cannot reach the SyncLab backend. Is it running on port 8000?', 0);
  }
  if (!res.ok) {
    let msg = `${res.status} ${res.statusText}`;
    try {
      const body = await res.json();
      msg = describeDetail(body.detail);
    } catch {
      /* keep status text */
    }
    throw new ApiError(msg, res.status);
  }
  return (await res.json()) as T;
}

const post = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

export const api = {
  health: () => request<{ status: string }>('/api/health'),
  state: () => request<SimState>('/api/simulation/state'),
  create: (cfg: SimConfig) => post<SimState>('/api/simulation/create', cfg),
  start: () => post<SimState>('/api/simulation/start'),
  pause: () => post<SimState>('/api/simulation/pause'),
  resume: () => post<SimState>('/api/simulation/resume'),
  stop: () => post<SimState>('/api/simulation/stop'),
  reset: () => post<SimState>('/api/simulation/reset'),
  events: (limit = 2000) => request<SimEvent[]>(`/api/simulation/events?min_seq=0&limit=${limit}`),
  results: () => request<Record<string, unknown>>('/api/simulation/results'),
  compare: (cfg: SimConfig) => post<CompareResponse>('/api/simulation/compare', cfg),
  exportUrl: (format: 'csv' | 'json') => `${BASE}/api/simulation/events/export?format=${format}`,
};

export function wsUrl(lastSeq = 0): string {
  const override = import.meta.env.VITE_WS_BASE as string | undefined;
  if (override) return `${override}/ws/events?last_seq=${lastSeq}`;
  if (BASE) return `${BASE.replace(/^http/, 'ws')}/ws/events?last_seq=${lastSeq}`;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws/events?last_seq=${lastSeq}`;
}

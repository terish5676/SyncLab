import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useRef, type ReactNode } from 'react';
import { api, ApiError, wsUrl } from './api';
import { DEFAULT_CONFIG, configErrors } from './lib/presets';
import type { ConnState, SimConfig, SimEvent, SimState } from './types';

export interface Toast {
  id: number;
  kind: 'ok' | 'error';
  text: string;
}

export interface AppState {
  conn: ConnState;
  sim: SimState | null;
  events: SimEvent[];
  toasts: Toast[];
  draft: SimConfig;
  busy: boolean;
  focusId: string | null;
  /** latest event time on the server clock and when we received it (for live cursors) */
  clock: { rel: number; at: number };
}

type Action =
  | { type: 'conn'; conn: ConnState }
  | { type: 'sim'; sim: SimState }
  | { type: 'clear-events' }
  | { type: 'events'; events: SimEvent[] }
  | { type: 'toast'; toast: Toast }
  | { type: 'untoast'; id: number }
  | { type: 'draft'; patch: Partial<SimConfig> }
  | { type: 'draft-replace'; config: SimConfig }
  | { type: 'busy'; busy: boolean }
  | { type: 'focus'; id: string | null };

function loadDraft(): SimConfig {
  try {
    const raw = localStorage.getItem('synclab.draft');
    if (raw) return { ...DEFAULT_CONFIG, ...(JSON.parse(raw) as Partial<SimConfig>) };
  } catch {
    /* storage unavailable */
  }
  return DEFAULT_CONFIG;
}

export function mergeEvents(existing: SimEvent[], incoming: SimEvent[]): SimEvent[] {
  let out = existing;
  let copied = false;
  for (const ev of incoming) {
    if (ev.event_type === 'SIMULATION_RESET') {
      out = [];
      copied = true;
    }
    const last = out.length ? out[out.length - 1] : null;
    if (!last || ev.seq > last.seq) {
      if (!copied) {
        out = out.slice();
        copied = true;
      }
      out.push(ev);
      continue;
    }
    if (out.some((e) => e.seq === ev.seq)) continue;
    if (!copied) {
      out = out.slice();
      copied = true;
    }
    out.push(ev);
    out.sort((a, b) => a.seq - b.seq);
  }
  return out;
}

export function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case 'conn':
      return s.conn === a.conn ? s : { ...s, conn: a.conn };
    case 'sim':
      return { ...s, sim: a.sim };
    case 'clear-events':
      return { ...s, events: [], clock: { rel: 0, at: performance.now() } };
    case 'events': {
      const events = mergeEvents(s.events, a.events);
      const last = events[events.length - 1];
      return { ...s, events, clock: last ? { rel: last.timestamp_rel_ms, at: performance.now() } : s.clock };
    }
    case 'toast':
      return { ...s, toasts: [...s.toasts.slice(-3), a.toast] };
    case 'untoast':
      return { ...s, toasts: s.toasts.filter((t) => t.id !== a.id) };
    case 'draft':
      return { ...s, draft: { ...s.draft, ...a.patch } };
    case 'draft-replace':
      return { ...s, draft: a.config };
    case 'busy':
      return { ...s, busy: a.busy };
    case 'focus':
      return { ...s, focusId: a.id };
    default:
      return s;
  }
}

export interface Actions {
  launch: () => Promise<void>;
  pause: () => Promise<void>;
  resume: () => Promise<void>;
  stop: () => Promise<void>;
  reset: () => Promise<void>;
  setDraft: (patch: Partial<SimConfig>) => void;
  replaceDraft: (c: SimConfig) => void;
  focus: (id: string | null) => void;
  toast: (kind: Toast['kind'], text: string) => void;
  dismissToast: (id: number) => void;
}

const StateCtx = createContext<AppState | null>(null);
const ActionCtx = createContext<Actions | null>(null);

let toastSeq = 1;

export function SyncProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, (): AppState => ({
    conn: 'connecting',
    sim: null,
    events: [],
    toasts: [],
    draft: loadDraft(),
    busy: false,
    focusId: null,
    clock: { rel: 0, at: 0 },
  }));
  const draftRef = useRef(state.draft);
  draftRef.current = state.draft;

  useEffect(() => {
    try {
      localStorage.setItem('synclab.draft', JSON.stringify(state.draft));
    } catch {
      /* ignore */
    }
  }, [state.draft]);

  // ---- state refresh (throttled) ----
  const refreshRef = useRef<{ timer: number | null; inflight: boolean; again: boolean }>({ timer: null, inflight: false, again: false });
  const refresh = useCallback(() => {
    const r = refreshRef.current;
    if (r.inflight) {
      r.again = true;
      return;
    }
    if (r.timer !== null) return;
    r.timer = window.setTimeout(async () => {
      r.timer = null;
      r.inflight = true;
      try {
        const sim = await api.state();
        dispatch({ type: 'sim', sim });
      } catch {
        /* the socket status tells the user about outages */
      } finally {
        r.inflight = false;
        if (r.again) {
          r.again = false;
          refresh();
        }
      }
    }, 60);
  }, []);

  const toast = useCallback((kind: Toast['kind'], text: string) => {
    const id = toastSeq++;
    dispatch({ type: 'toast', toast: { id, kind, text } });
    window.setTimeout(() => dispatch({ type: 'untoast', id }), kind === 'error' ? 7000 : 3500);
  }, []);

  // ---- websocket with batching + reconnect ----
  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    let attempts = 0;
    let retryTimer: number | undefined;
    let pingTimer: number | undefined;
    let buffer: SimEvent[] = [];
    let flushTimer: number | undefined;

    const flush = () => {
      flushTimer = undefined;
      if (!buffer.length) return;
      const batch = buffer;
      buffer = [];
      dispatch({ type: 'events', events: batch });
      refresh();
    };

    const connect = () => {
      if (closed) return;
      dispatch({ type: 'conn', conn: attempts === 0 ? 'connecting' : attempts < 3 ? 'retrying' : 'offline' });
      try {
        ws = new WebSocket(wsUrl(0));
      } catch {
        schedule();
        return;
      }
      ws.onopen = () => {
        attempts = 0;
        dispatch({ type: 'conn', conn: 'live' });
        window.clearInterval(pingTimer);
        pingTimer = window.setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'PING' }));
        }, 15000);
      };
      ws.onmessage = (m) => {
        try {
          const msg = JSON.parse(m.data as string);
          if (msg.type === 'SNAPSHOT') {
            buffer = [];
            dispatch({ type: 'clear-events' });
            dispatch({ type: 'sim', sim: msg.state as SimState });
          } else if (typeof msg.seq === 'number') {
            buffer.push(msg as SimEvent);
            if (flushTimer === undefined) flushTimer = window.setTimeout(flush, 70);
          }
        } catch {
          /* ignore malformed frames */
        }
      };
      ws.onclose = () => {
        window.clearInterval(pingTimer);
        if (!closed) schedule();
      };
      ws.onerror = () => ws?.close();
    };

    const schedule = () => {
      attempts += 1;
      dispatch({ type: 'conn', conn: attempts < 3 ? 'retrying' : 'offline' });
      retryTimer = window.setTimeout(connect, Math.min(5000, 400 * 2 ** attempts));
    };

    connect();
    refresh();
    return () => {
      closed = true;
      window.clearTimeout(retryTimer);
      window.clearTimeout(flushTimer);
      window.clearInterval(pingTimer);
      ws?.close();
    };
  }, [refresh]);

  // ---- poll while a run is live so progress bars and clocks advance ----
  const status = state.sim?.status;
  useEffect(() => {
    if (status !== 'RUNNING' && status !== 'PAUSED') return;
    const t = window.setInterval(refresh, 250);
    return () => window.clearInterval(t);
  }, [status, refresh]);

  // ---- actions ----
  const guard = useCallback(
    async (fn: () => Promise<void>) => {
      try {
        await fn();
      } catch (e) {
        toast('error', e instanceof ApiError ? e.message : 'Something went wrong.');
      }
    },
    [toast],
  );

  const actions = useMemo<Actions>(
    () => ({
      launch: () =>
        guard(async () => {
          const errs = configErrors(draftRef.current);
          const first = Object.entries(errs)[0];
          if (first) throw new ApiError(`${first[0].replace(/_/g, ' ')} must be ${first[1]}.`, 422);
          dispatch({ type: 'busy', busy: true });
          try {
            const created = await api.create(draftRef.current);
            dispatch({ type: 'clear-events' });
            dispatch({ type: 'sim', sim: created });
            const started = await api.start();
            dispatch({ type: 'sim', sim: started });
          } finally {
            dispatch({ type: 'busy', busy: false });
          }
        }),
      pause: () => guard(async () => dispatch({ type: 'sim', sim: await api.pause() })),
      resume: () => guard(async () => dispatch({ type: 'sim', sim: await api.resume() })),
      stop: () => guard(async () => dispatch({ type: 'sim', sim: await api.stop() })),
      reset: () =>
        guard(async () => {
          dispatch({ type: 'busy', busy: true });
          try {
            const sim = await api.reset();
            dispatch({ type: 'sim', sim });
          } finally {
            dispatch({ type: 'busy', busy: false });
          }
        }),
      setDraft: (patch) => dispatch({ type: 'draft', patch }),
      replaceDraft: (config) => dispatch({ type: 'draft-replace', config }),
      focus: (id) => dispatch({ type: 'focus', id }),
      toast,
      dismissToast: (id) => dispatch({ type: 'untoast', id }),
    }),
    [guard, toast],
  );

  return (
    <StateCtx.Provider value={state}>
      <ActionCtx.Provider value={actions}>{children}</ActionCtx.Provider>
    </StateCtx.Provider>
  );
}

export function useSync(): AppState {
  const s = useContext(StateCtx);
  if (!s) throw new Error('useSync outside provider');
  return s;
}
export function useActions(): Actions {
  const a = useContext(ActionCtx);
  if (!a) throw new Error('useActions outside provider');
  return a;
}

/** Live "now" on the server's relative clock, ticking while a run is in progress. */
export function useLiveNow(intervalMs = 100): number {
  const { clock, sim } = useSync();
  const [, force] = useReducer((n: number) => n + 1, 0);
  const running = sim?.status === 'RUNNING';
  useEffect(() => {
    if (!running) return;
    const t = window.setInterval(force, intervalMs);
    return () => window.clearInterval(t);
  }, [running, intervalMs]);
  return clock.rel + (running ? performance.now() - clock.at : 0);
}

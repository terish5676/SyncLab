import type { SimEvent } from '../types';

export type SegKind = 'wait' | 'read' | 'write';
export interface Segment {
  kind: SegKind;
  start: number;
  end: number;
  open: boolean;
  cancelled?: boolean;
}
export interface Lane {
  id: string;
  type: 'READER' | 'WRITER';
  segments: Segment[];
  cancelledAt?: number;
  errorAt?: number;
}

/** Turn the raw event stream into per-process swim lanes. `now` closes any still-open segment. */
export function buildLanes(events: SimEvent[], now: number): Lane[] {
  const lanes = new Map<string, Lane>();
  const openWait = new Map<string, number>();
  const openRun = new Map<string, { kind: SegKind; start: number }>();

  const laneFor = (e: SimEvent): Lane | null => {
    if (!e.process_id || !e.process_type) return null;
    let l = lanes.get(e.process_id);
    if (!l) {
      l = { id: e.process_id, type: e.process_type, segments: [] };
      lanes.set(e.process_id, l);
    }
    return l;
  };

  for (const e of events) {
    const lane = laneFor(e);
    if (!lane) continue;
    const t = e.timestamp_rel_ms;
    switch (e.event_type) {
      case 'PROCESS_REQUESTED':
        openWait.set(lane.id, t);
        break;
      case 'READ_ACQUIRED':
      case 'WRITE_ACQUIRED': {
        const w = openWait.get(lane.id);
        if (w !== undefined) {
          lane.segments.push({ kind: 'wait', start: w, end: t, open: false });
          openWait.delete(lane.id);
        }
        openRun.set(lane.id, { kind: e.event_type === 'READ_ACQUIRED' ? 'read' : 'write', start: t });
        break;
      }
      case 'READ_RELEASED':
      case 'WRITE_COMMITTED': {
        const r = openRun.get(lane.id);
        if (r) {
          lane.segments.push({ kind: r.kind, start: r.start, end: t, open: false });
          openRun.delete(lane.id);
        }
        break;
      }
      case 'PROCESS_CANCELLED': {
        const w = openWait.get(lane.id);
        if (w !== undefined) {
          lane.segments.push({ kind: 'wait', start: w, end: t, open: false, cancelled: true });
          openWait.delete(lane.id);
        }
        const r = openRun.get(lane.id);
        if (r) {
          lane.segments.push({ kind: r.kind, start: r.start, end: t, open: false, cancelled: true });
          openRun.delete(lane.id);
        }
        lane.cancelledAt = t;
        break;
      }
      case 'PROCESS_ERROR':
      case 'INVARIANT_VIOLATION':
        lane.errorAt = t;
        break;
    }
  }
  for (const [id, start] of openWait) {
    lanes.get(id)!.segments.push({ kind: 'wait', start, end: Math.max(now, start), open: true });
  }
  for (const [id, r] of openRun) {
    lanes.get(id)!.segments.push({ kind: r.kind, start: r.start, end: Math.max(now, r.start), open: true });
  }
  return [...lanes.values()].sort((a, b) =>
    a.type === b.type ? a.id.localeCompare(b.id) : a.type === 'READER' ? -1 : 1,
  );
}

/** Intervals during which a writer held the resource (committed or in progress). */
export function writerBands(lanes: Lane[]): { start: number; end: number; id: string }[] {
  const out: { start: number; end: number; id: string }[] = [];
  for (const l of lanes) {
    for (const s of l.segments) if (s.kind === 'write') out.push({ start: s.start, end: s.end, id: l.id });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Independent overlap audit computed from intervals rather than from backend counters. */
export function auditOverlaps(lanes: Lane[]): { readerWriter: number; writerWriter: number } {
  const writes = writerBands(lanes);
  let writerWriter = 0;
  for (let i = 1; i < writes.length; i++) {
    if (writes[i].start < writes[i - 1].end - 0.5) writerWriter++;
  }
  let readerWriter = 0;
  for (const l of lanes) {
    if (l.type !== 'READER') continue;
    for (const s of l.segments) {
      if (s.kind !== 'read') continue;
      for (const w of writes) {
        if (s.start < w.end - 0.5 && w.start < s.end - 0.5) readerWriter++;
      }
    }
  }
  return { readerWriter, writerWriter };
}

export function longestOpenWait(lanes: Lane[]): { id: string; ms: number } | null {
  let best: { id: string; ms: number } | null = null;
  for (const l of lanes) {
    for (const s of l.segments) {
      if (s.kind === 'wait' && s.open) {
        const ms = s.end - s.start;
        if (!best || ms > best.ms) best = { id: l.id, ms };
      }
    }
  }
  return best;
}

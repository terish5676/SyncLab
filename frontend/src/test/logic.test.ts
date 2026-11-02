import { describe, expect, it } from 'vitest';
import { buildLanes, auditOverlaps, longestOpenWait } from '../lib/lanes';
import { checkInvariants, expectedValue, verdict } from '../lib/invariants';
import { mergeEvents } from '../store';
import { configErrors, DEFAULT_CONFIG } from '../lib/presets';
import { fmtMs, niceTicks } from '../lib/format';
import type { SimEvent, SimState } from '../types';

let seq = 0;
function ev(t: number, type: string, id: string | null, over: Partial<SimEvent> = {}): SimEvent {
  seq += 1;
  return {
    seq, timestamp_rel_ms: t, timestamp_iso: '', process_id: id,
    process_type: id ? (id.startsWith('R') ? 'READER' : 'WRITER') : null, event_type: type,
    from_state: null, to_state: null, resource_value: 100, resource_version: 0,
    active_readers: 0, active_writers: 0, waiting_readers: 0, waiting_writers: 0, details: '', ...over,
  };
}

const good = (): SimEvent[] => {
  seq = 0;
  return [
    ev(0, 'PROCESS_REQUESTED', 'R01'), ev(5, 'READ_ACQUIRED', 'R01', { active_readers: 1 }),
    ev(10, 'PROCESS_REQUESTED', 'W01'), ev(100, 'READ_RELEASED', 'R01'),
    ev(101, 'WRITE_ACQUIRED', 'W01', { active_writers: 1 }),
    ev(201, 'WRITE_COMMITTED', 'W01', { resource_value: 110, resource_version: 1 }),
  ];
};

function sim(over: Partial<SimState> = {}): SimState {
  return { status: 'COMPLETED', config: { ...DEFAULT_CONFIG, initial_value: 100, writer_op: 'ADD', writer_amount: 10 }, resource_value: 110, resource_version: 1, ...over } as SimState;
}

describe('lanes', () => {
  it('builds wait/read/write segments from events', () => {
    const lanes = buildLanes(good(), 201);
    const w = lanes.find((l) => l.id === 'W01')!;
    expect(w.segments.map((s) => s.kind)).toEqual(['wait', 'write']);
    expect(w.segments[0]).toMatchObject({ start: 10, end: 101 });
    expect(lanes[0].id).toBe('R01');
  });
  it('keeps open waits open until now', () => {
    seq = 0;
    const lanes = buildLanes([ev(0, 'PROCESS_REQUESTED', 'W01')], 500);
    expect(longestOpenWait(lanes)).toEqual({ id: 'W01', ms: 500 });
  });
  it('detects reader/writer overlap independently of counters', () => {
    seq = 0;
    const bad = [
      ev(0, 'PROCESS_REQUESTED', 'R01'), ev(1, 'READ_ACQUIRED', 'R01'),
      ev(2, 'PROCESS_REQUESTED', 'W01'), ev(3, 'WRITE_ACQUIRED', 'W01'),
      ev(50, 'READ_RELEASED', 'R01'), ev(60, 'WRITE_COMMITTED', 'W01'),
    ];
    expect(auditOverlaps(buildLanes(bad, 60)).readerWriter).toBe(1);
    expect(auditOverlaps(buildLanes(good(), 201))).toEqual({ readerWriter: 0, writerWriter: 0 });
  });
});

describe('invariants', () => {
  it('passes a clean run', () => {
    const invs = checkInvariants(good(), sim());
    expect(invs.every((i) => i.status === 'holding')).toBe(true);
    expect(verdict(invs)).toBe('safe');
  });
  it('flags a lost update', () => {
    const invs = checkInvariants(good(), sim({ resource_value: 100 }));
    expect(invs.find((i) => i.id === 'lost-updates')!.status).toBe('violated');
    expect(verdict(invs)).toBe('violated');
  });
  it('flags a version mismatch', () => {
    expect(checkInvariants(good(), sim({ resource_version: 3 })).find((i) => i.id === 'versioning')!.status).toBe('violated');
  });
  it('flags simultaneous reader and writer counters', () => {
    const e = good();
    e[4] = { ...e[4], active_readers: 1 };
    expect(checkInvariants(e, sim()).find((i) => i.id === 'exclusion')!.status).toBe('violated');
  });
  it('is pending with no events', () => {
    expect(verdict(checkInvariants([], null))).toBe('pending');
  });
  it('computes expected values exactly', () => {
    expect(expectedValue(100, 'ADD', 5, 10)).toBe(150);
    expect(expectedValue(2, 'MULTIPLY', 3, 4)).toBe(162);
    expect(expectedValue(7, 'SET', 9, 0)).toBe(7);
    expect(expectedValue(1, 'MULTIPLY', 1000, 50)).toBeNull();
  });
});

describe('event merge', () => {
  it('dedupes, orders and resets', () => {
    seq = 0;
    const a = ev(0, 'X', null), b = ev(1, 'X', null), c = ev(2, 'X', null);
    expect(mergeEvents([a], [c, b, a]).map((e) => e.seq)).toEqual([1, 2, 3]);
    const reset = { ...ev(0, 'SIMULATION_RESET', null), seq: 1 };
    expect(mergeEvents([a, b, c], [reset]).map((e) => e.event_type)).toEqual(['SIMULATION_RESET']);
  });
});

describe('config + format', () => {
  it('validates ranges like the backend', () => {
    expect(configErrors(DEFAULT_CONFIG)).toEqual({});
    expect(configErrors({ ...DEFAULT_CONFIG, reader_count: 0 }).reader_count).toBeDefined();
    expect(configErrors({ ...DEFAULT_CONFIG, writer_count: 51 }).writer_count).toBeDefined();
    expect(configErrors({ ...DEFAULT_CONFIG, read_duration_ms: NaN }).read_duration_ms).toBeDefined();
  });
  it('formats durations', () => {
    expect(fmtMs(250)).toBe('250 ms');
    expect(fmtMs(1500)).toBe('1.5 s');
    expect(fmtMs(undefined)).toBe('–');
    expect(niceTicks(1000)[0]).toBe(0);
  });
});

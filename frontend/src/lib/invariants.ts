import type { SimEvent, SimState } from '../types';
import { auditOverlaps, buildLanes } from './lanes';

export type InvStatus = 'holding' | 'violated' | 'pending' | 'unverifiable';
export interface Invariant {
  id: string;
  title: string;
  rule: string;
  status: InvStatus;
  detail: string;
}

/** Expected final value after n committed writes, or null if it cannot be represented exactly. */
export function expectedValue(initial: number, op: string, amount: number, commits: number): number | null {
  const i = BigInt(initial);
  const a = BigInt(amount);
  const n = BigInt(commits);
  let v: bigint;
  switch (op) {
    case 'ADD': v = i + a * n; break;
    case 'SUBTRACT': v = i - a * n; break;
    case 'MULTIPLY': v = commits === 0 ? i : i * a ** n; break;
    case 'SET': v = commits === 0 ? i : a; break;
    default: return null;
  }
  const abs = v < 0n ? -v : v;
  if (abs > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(v);
}

export function checkInvariants(events: SimEvent[], sim: SimState | null): Invariant[] {
  const finished = !!sim && ['COMPLETED', 'CANCELLED', 'IDLE'].includes(sim.status) && events.length > 0;
  const hasData = events.length > 0;
  const pendingText = hasData ? 'Tracking live…' : 'Waiting for a run.';

  let overlapEvents = 0;
  let maxWriters = 0;
  let minReaders = 0;
  let commits = 0;
  for (const e of events) {
    if (e.active_readers > 0 && e.active_writers > 0) overlapEvents++;
    maxWriters = Math.max(maxWriters, e.active_writers);
    minReaders = Math.min(minReaders, e.active_readers, e.waiting_readers, e.waiting_writers);
    if (e.event_type === 'WRITE_COMMITTED') commits++;
  }
  const lastT = events.length ? events[events.length - 1].timestamp_rel_ms : 0;
  const lanes = buildLanes(events, lastT);
  const audit = auditOverlaps(lanes);
  const faults = events.filter((e) => e.event_type === 'INVARIANT_VIOLATION' || e.event_type === 'PROCESS_ERROR').length;

  const out: Invariant[] = [];

  const rw = overlapEvents + audit.readerWriter + faults;
  out.push({
    id: 'exclusion',
    title: 'Readers and writers never overlap',
    rule: 'R(t) > 0 ⇒ W(t) = 0',
    status: !hasData ? 'pending' : rw > 0 ? 'violated' : 'holding',
    detail: !hasData
      ? pendingText
      : rw > 0
        ? `${rw} overlap${rw === 1 ? '' : 's'} detected.`
        : `Checked ${events.length} events and every read interval against every write interval.`,
  });

  const ww = audit.writerWriter + (maxWriters > 1 ? 1 : 0);
  out.push({
    id: 'single-writer',
    title: 'One writer at a time',
    rule: 'W(t) ∈ {0, 1}',
    status: !hasData ? 'pending' : ww > 0 ? 'violated' : 'holding',
    detail: !hasData ? pendingText : ww > 0 ? `${ww} overlapping write interval(s).` : `Peak simultaneous writers: ${maxWriters}.`,
  });

  out.push({
    id: 'non-negative',
    title: 'Counters never go negative',
    rule: 'R(t) ≥ 0',
    status: !hasData ? 'pending' : minReaders < 0 ? 'violated' : 'holding',
    detail: !hasData ? pendingText : minReaders < 0 ? 'A reader or queue counter dropped below zero.' : 'Every counter in every event is ≥ 0.',
  });

  let verStatus: InvStatus = 'pending';
  let verDetail = pendingText;
  if (sim && hasData) {
    if (!finished) verDetail = `Version ${sim.resource_version}, ${commits} commit${commits === 1 ? '' : 's'} so far.`;
    else {
      verStatus = sim.resource_version === commits ? 'holding' : 'violated';
      verDetail = `Version ${sim.resource_version} after ${commits} committed write${commits === 1 ? '' : 's'}.`;
    }
  }
  out.push({
    id: 'versioning',
    title: 'One version bump per committed write',
    rule: 'V_final = V_initial + N_writes',
    status: verStatus,
    detail: verDetail,
  });

  let lostStatus: InvStatus = 'pending';
  let lostDetail = pendingText;
  if (sim && hasData && finished) {
    const exp = expectedValue(sim.config.initial_value, sim.config.writer_op, sim.config.writer_amount, commits);
    if (exp === null) {
      lostStatus = 'unverifiable';
      lostDetail = 'Value exceeds the exact integer range of the browser. Check it in the API response.';
    } else {
      lostStatus = exp === sim.resource_value ? 'holding' : 'violated';
      lostDetail = `Expected ${exp.toLocaleString()} from ${commits} write${commits === 1 ? '' : 's'}; resource holds ${sim.resource_value.toLocaleString()}.`;
    }
  }
  out.push({
    id: 'lost-updates',
    title: 'No lost updates',
    rule: 'value = f(f(…f(initial)))',
    status: lostStatus,
    detail: lostDetail,
  });
  return out;
}

export function verdict(invs: Invariant[]): 'safe' | 'violated' | 'pending' {
  if (invs.some((i) => i.status === 'violated')) return 'violated';
  if (invs.every((i) => i.status === 'holding' || i.status === 'unverifiable')) return 'safe';
  return 'pending';
}

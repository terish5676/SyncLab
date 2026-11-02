import { useMemo } from 'react';
import { useLiveNow, useSync } from '../store';
import { buildLanes, longestOpenWait } from '../lib/lanes';
import { checkInvariants, verdict } from '../lib/invariants';
import { fmtMs, fmtPct } from '../lib/format';
import { IconCheck, IconCross, IconDots, IconWarn } from './Icons';

export function StatStrip() {
  const { sim } = useSync();
  const m = sim?.metrics;
  const procs = sim?.processes ?? [];
  const waiting = procs.filter((p) => p.state === 'WAITING').length;
  const done = (m?.completed_reads ?? 0) + (m?.completed_writes ?? 0);
  return (
    <div className="strip" role="group" aria-label="Headline numbers">
      <div className="cell c-read">
        <div className="tick"><i />Readers inside</div>
        <div className="stat"><span className="v num">{sim?.active_reader_ids.length ?? 0}</span><span className="s">of {m?.total_readers ?? 0} total</span></div>
      </div>
      <div className="cell c-write">
        <div className="tick"><i />Writer inside</div>
        <div className="stat"><span className="v num">{sim?.active_writer_id ? 1 : 0}</span><span className="s">of {m?.total_writers ?? 0} total</span></div>
      </div>
      <div className="cell c-wait">
        <div className="tick"><i />Waiting</div>
        <div className="stat"><span className="v num">{waiting}</span><span className="s">{sim?.semaphores.waiting_writers ?? 0} writers, {sim?.semaphores.waiting_readers ?? 0} readers</span></div>
      </div>
      <div className="cell c-ver">
        <div className="tick"><i />Version</div>
        <div className="stat"><span className="v num">{sim?.resource_version ?? 0}</span><span className="s">{done} operations done</span></div>
      </div>
    </div>
  );
}

export function MetricsPanel() {
  const { sim, events } = useSync();
  const now = useLiveNow(200);
  const m = sim?.metrics;
  const lanes = useMemo(() => buildLanes(events, now), [events, now]);
  const longest = longestOpenWait(lanes);
  const hasR = (m?.completed_reads ?? 0) > 0;
  const hasW = (m?.completed_writes ?? 0) > 0;
  const items: [string, string, string][] = [
    ['Average reader wait', hasR ? fmtMs(m!.avg_reader_wait_ms) : 'n/a', `max ${hasR ? fmtMs(m!.max_reader_wait_ms) : 'n/a'}`],
    ['Average writer wait', hasW ? fmtMs(m!.avg_writer_wait_ms) : 'n/a', `max ${hasW ? fmtMs(m!.max_writer_wait_ms) : 'n/a'}`],
    ['Longest wait right now', longest ? fmtMs(longest.ms) : 'none', longest ? `${longest.id} is still waiting` : 'nobody is blocked'],
    ['Throughput', m ? `${m.throughput_ops_per_sec.toFixed(1)}/s` : 'n/a', 'completed operations per second'],
    ['Resource occupancy', m ? fmtPct(m.resource_occupancy_pct) : 'n/a', 'time held by anyone, not CPU'],
    ['Elapsed', m ? fmtMs(m.total_elapsed_ms) : 'n/a', 'pauses excluded'],
  ];
  return (
    <section className="section" aria-labelledby="met-h">
      <header><h2 id="met-h">Measurements</h2><span className="mono">from the backend</span></header>
      {m?.starvation_warning && (
        <div className="banner warn" role="alert" style={{ margin: '16px 0' }}>
          <IconWarn />
          <div>Starvation warning. {m.starvation_details}<div className="muted" style={{ fontWeight: 500, fontSize: 13 }}>Heuristic: a wait far above the other side&apos;s average. It flags unusual waiting, not proof of starvation.</div></div>
        </div>
      )}
      <div className="metrics" style={{ marginTop: m?.starvation_warning ? 0 : 0 }}>
        {items.map(([l, v, s]) => (
          <div className="metric" key={l}><span className="v num">{v}</span><span className="l">{l}</span><span className="s">{s}</span></div>
        ))}
      </div>
    </section>
  );
}

export function InvariantsPanel({ compact = false }: { compact?: boolean }) {
  const { sim, events } = useSync();
  const invs = useMemo(() => checkInvariants(events, sim), [events, sim]);
  const v = verdict(invs);
  return (
    <section className="section" aria-labelledby="inv-h">
      <header>
        <h2 id="inv-h">Safety checks</h2>
        <span className={`stamp ${v === 'violated' ? 'bad' : v === 'pending' ? 'wait' : ''}`}>
          {v === 'safe' ? 'All hold' : v === 'violated' ? 'Violation' : 'Checking'}
        </span>
      </header>
      <div className="invs">
        {invs.map((i) => (
          <div className="inv" key={i.id} data-s={i.status}>
            <span className="mark" aria-hidden="true">
              {i.status === 'holding' ? <IconCheck /> : i.status === 'violated' ? <IconCross /> : <IconDots />}
            </span>
            <div>
              <b>{i.title} <span className="sr">({i.status})</span></b>
              {!compact && <span className="rule">{i.rule}</span>}
              <p>{i.detail}</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

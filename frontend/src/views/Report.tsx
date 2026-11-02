import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, ApiError } from '../api';
import { checkInvariants, verdict } from '../lib/invariants';
import { ALGO_LABEL, download, fmtClock, fmtMs, fmtNum, fmtPct } from '../lib/format';
import { InvariantsPanel } from '../components/Panels';
import { EmptyMark, IconDown } from '../components/Icons';
import { Letters, PageHead } from '../components/Shell';
import { STATE_WORD } from '../components/Icons';
import { useActions, useSync } from '../store';

type SortKey = 'id' | 'wait' | 'duration';

export function Report() {
  const { sim, events } = useSync();
  const { toast } = useActions();
  const [sort, setSort] = useState<SortKey>('wait');
  const invs = useMemo(() => checkInvariants(events, sim), [events, sim]);
  const v = verdict(invs);
  const procs = useMemo(() => {
    const p = [...(sim?.processes ?? [])];
    p.sort((a, b) => (sort === 'id' ? a.id.localeCompare(b.id) : sort === 'wait' ? b.wait_time_ms - a.wait_time_ms : b.duration_ms - a.duration_ms));
    return p;
  }, [sim, sort]);

  if (!sim || events.length === 0) {
    return (
      <div className="page">
        <PageHead title={<Letters text="Run report." />} />
        <div className="panel"><div className="empty"><EmptyMark /><h3>Nothing to report yet</h3><p>Finish a run in the Lab and the full report appears here, ready to export.</p><a className="btn primary" href="#/lab">Go to the Lab</a></div></div>
      </div>
    );
  }
  const m = sim.metrics;
  const c = sim.config;
  const finished = sim.status === 'COMPLETED' || sim.status === 'CANCELLED';

  const exportJson = async () => {
    try {
      const results = await api.results();
      download(`synclab-report-${sim.simulation_id}.json`, JSON.stringify({ ...results, safety_checks: invs, events }, null, 2), 'application/json');
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Export failed.');
    }
  };

  const chartData = procs.filter((p) => p.state !== 'CREATED').slice(0, 60).sort((a, b) => a.id.localeCompare(b.id)).map((p) => ({ id: p.id, wait: p.wait_time_ms, type: p.process_type }));

  const kv: [string, string][] = [
    ['Algorithm', ALGO_LABEL[sim.algorithm]],
    ['Status', finished ? (sim.status === 'COMPLETED' ? 'Finished' : 'Stopped early') : sim.status.toLowerCase()],
    ['Started', fmtClock(sim.started_at)],
    ['Finished', fmtClock(sim.finished_at)],
    ['Workload', `${c.reader_count} readers, ${c.writer_count} writers`],
    ['Durations', `read ${fmtMs(c.read_duration_ms)}, write ${fmtMs(c.write_duration_ms)}`],
    ['Arrival gap', fmtMs(c.stagger_arrivals_ms)],
    ['Each write', `${c.writer_op.toLowerCase()} ${c.writer_amount}`],
    ['Started with', fmtNum(c.initial_value)],
    ['Ended with', `${fmtNum(sim.resource_value)} (version ${sim.resource_version})`],
    ['Reads done', `${m.completed_reads} of ${m.total_readers}`],
    ['Writes done', `${m.completed_writes} of ${m.total_writers}`],
    ['Average reader wait', m.completed_reads ? fmtMs(m.avg_reader_wait_ms) : 'n/a'],
    ['Longest reader wait', m.completed_reads ? fmtMs(m.max_reader_wait_ms) : 'n/a'],
    ['Average writer wait', m.completed_writes ? fmtMs(m.avg_writer_wait_ms) : 'n/a'],
    ['Longest writer wait', m.completed_writes ? fmtMs(m.max_writer_wait_ms) : 'n/a'],
    ['Throughput', `${m.throughput_ops_per_sec.toFixed(2)} ops/s over ${fmtMs(m.total_elapsed_ms)}`],
    ['Resource occupancy', fmtPct(m.resource_occupancy_pct)],
  ];

  return (
    <div className="page">
      <PageHead title={<Letters text="Run report." />} sub={`Run ${sim.simulation_id}. ${finished ? '' : 'Still in progress, so figures are provisional. '}Every figure comes from the backend or is re-derived from its event log.`}>
        <span className={`stamp ${v === 'violated' ? 'bad' : v === 'pending' ? 'wait' : ''}`}>{v === 'safe' ? 'Safe: all checks hold' : v === 'violated' ? 'Violation found' : 'Checks pending'}</span>
        <div className="controls no-print">
          <button className="btn" onClick={exportJson}><IconDown /> JSON</button>
          <a className="btn" href={api.exportUrl('csv')} download><IconDown /> Event CSV</a>
          <button className="btn" onClick={() => window.print()}>Print / PDF</button>
        </div>
      </PageHead>

      {m.starvation_warning && <div className="banner warn" role="alert"><span>Starvation warning. {m.starvation_details}</span></div>}

      <section className="section" aria-labelledby="sum-h">
        <header><h2 id="sum-h">Summary</h2></header>
        <dl className="kv">{kv.map(([k, val]) => (<div key={k}><dt>{k}</dt><dd className="num">{val}</dd></div>))}</dl>
      </section>

      <InvariantsPanel />

      <section className="section" aria-labelledby="w-h">
        <header><h2 id="w-h">Wait before admission, per thread</h2><span className="mono">ms{chartData.length === 60 ? ' · first 60' : ''}</span></header>
        <div style={{ height: 300, paddingTop: 20 }}>
          <ResponsiveContainer>
            <BarChart data={chartData} margin={{ top: 10, right: 8, left: -6, bottom: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--line)" />
              <XAxis dataKey="id" tickLine={false} axisLine={{ stroke: 'var(--line-strong)', strokeWidth: 1 }} tick={{ fill: 'var(--ink)' }} interval="preserveStartEnd" />
              <YAxis tickLine={false} axisLine={false} tick={{ fill: 'var(--ink-2)' }} width={52} />
              <Tooltip cursor={{ fill: 'var(--read)', fillOpacity: 0.07 }} contentStyle={{ background: 'var(--deep)', color: 'var(--on-deep)', border: 0, borderRadius: 6, boxShadow: 'var(--shadow-2)' }} labelStyle={{ color: 'var(--on-deep)', fontWeight: 650 }} itemStyle={{ color: 'var(--on-deep)' }} formatter={(val) => [`${Number(val).toFixed(1)} ms`, 'waited']} />
              <Bar dataKey="wait" isAnimationActive={false} radius={[3, 3, 0, 0]}>
                {chartData.map((d) => (<Cell key={d.id} fill={d.type === 'READER' ? 'var(--read)' : 'var(--write)'} />))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <p className="muted" style={{ paddingTop: 14, fontSize: 13.5, maxWidth: '70ch' }}>Green bars are readers, dark teal bars are writers. A tall run of dark bars next to short green ones is the signature of reader preference.</p>
      </section>

      <section className="panel" aria-labelledby="pt-h">
        <div className="panel-head">
          <h2 id="pt-h">Every thread</h2>
          <div className="chips no-print" role="group" aria-label="Sort threads">
            {([['wait', 'Longest wait'], ['duration', 'Longest hold'], ['id', 'ID']] as [SortKey, string][]).map(([k, l]) => (<button key={k} className="chip" aria-pressed={sort === k} onClick={() => setSort(k)}>{l}</button>))}
          </div>
        </div>
        <div className="log-scroll">
          <table className="tbl">
            <thead><tr><th>Thread</th><th>Role</th><th>State</th><th className="r">Waited</th><th className="r">Held</th></tr></thead>
            <tbody>
              {procs.map((p) => (
                <tr key={p.id}>
                  <td><span className="ev-pill" data-k={p.process_type === 'READER' ? 'r' : 'w'}>{p.id}</span></td>
                  <td>{p.process_type === 'READER' ? 'Reader' : 'Writer'}</td>
                  <td>{STATE_WORD[p.state]}</td>
                  <td className="m r">{p.state === 'CREATED' ? '–' : fmtMs(p.wait_time_ms)}</td>
                  <td className="m r">{p.duration_ms ? fmtMs(p.duration_ms) : '–'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

import { useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, LabelList, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { api, ApiError } from '../api';
import { ALGO_LABEL, ALGO_SHORT, fmtMs } from '../lib/format';
import { configErrors } from '../lib/presets';
import { Letters, PageHead } from '../components/Shell';
import { EmptyMark } from '../components/Icons';
import { useActions, useSync } from '../store';
import type { AlgorithmType, CompareResponse, Metrics } from '../types';

const ALGOS: AlgorithmType[] = ['reader_preference', 'writer_preference', 'fair_fifo'];

interface Agg {
  runs: number;
  mean: (k: keyof Metrics) => number;
  min: (k: keyof Metrics) => number;
  max: (k: keyof Metrics) => number;
  starved: number;
  value: number;
  version: number;
}

function aggregate(results: CompareResponse[], algo: AlgorithmType): Agg {
  const ms = results.map((r) => r.comparison[algo].metrics);
  const num = (k: keyof Metrics) => ms.map((m) => Number(m[k]));
  return {
    runs: ms.length,
    mean: (k) => num(k).reduce((a, b) => a + b, 0) / Math.max(1, ms.length),
    min: (k) => Math.min(...num(k)),
    max: (k) => Math.max(...num(k)),
    starved: ms.filter((m) => m.starvation_warning).length,
    value: results[results.length - 1].comparison[algo].final_value,
    version: results[results.length - 1].comparison[algo].final_version,
  };
}

function Tip({ active, payload, label, unit }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; unit: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="chart-tip">
      <strong>{label}</strong>
      {payload.map((p) => (<div key={p.name}><span>{p.name}</span><span className="num">{p.value.toFixed(1)} {unit}</span></div>))}
    </div>
  );
}

function Chart({ title, note, data, series, unit }: { title: string; note: string; data: Record<string, number | string>[]; series: { key: string; name: string; color: string }[]; unit: string }) {
  return (
    <div className="chart-box" role="group" aria-label={title}>
      <h3>{title}</h3>
      <p>{note}</p>
      <div style={{ width: '100%', height: 270 }}>
        <ResponsiveContainer>
          <BarChart data={data} margin={{ top: 18, right: 8, left: -6, bottom: 0 }} barGap={4}>
            <CartesianGrid vertical={false} stroke="var(--line)" />
            <XAxis dataKey="algo" tickLine={false} axisLine={{ stroke: 'var(--line-strong)', strokeWidth: 1 }} tick={{ fill: 'var(--ink)' }} />
            <YAxis tickLine={false} axisLine={false} tick={{ fill: 'var(--ink-2)' }} width={52} />
            <Tooltip content={<Tip unit={unit} />} cursor={{ fill: 'var(--read)', fillOpacity: 0.07 }} />
            {series.length > 1 && <Legend iconType="circle" iconSize={9} wrapperStyle={{ fontWeight: 600, fontSize: 13 }} />}
            {series.map((s) => (
              <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={[4, 4, 0, 0]} isAnimationActive={false} maxBarSize={56}>
                <LabelList dataKey={s.key} position="top" formatter={(v) => (typeof v === 'number' ? (v >= 100 ? Math.round(v) : v.toFixed(1)) : '')} style={{ fill: 'var(--ink)', fontWeight: 600 }} />
              </Bar>
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export function Versus() {
  const { draft, sim } = useSync();
  const { toast } = useActions();
  const [runs, setRuns] = useState(3);
  const [results, setResults] = useState<CompareResponse[]>([]);
  const [busy, setBusy] = useState<null | { i: number; n: number }>(null);
  const [workload, setWorkload] = useState(draft);
  const live = sim?.status === 'RUNNING' || sim?.status === 'PAUSED';

  const go = async () => {
    const errs = Object.entries(configErrors(draft))[0];
    if (errs) return toast('error', `${errs[0].replace(/_/g, ' ')} must be ${errs[1]}.`);
    setResults([]);
    setWorkload(draft);
    const acc: CompareResponse[] = [];
    try {
      for (let i = 1; i <= runs; i++) {
        setBusy({ i, n: runs });
        acc.push(await api.compare(draft));
        setResults([...acc]);
      }
    } catch (e) {
      toast('error', e instanceof ApiError ? e.message : 'Comparison failed.');
    } finally {
      setBusy(null);
    }
  };

  const aggs = useMemo(() => (results.length ? ALGOS.map((a) => ({ a, g: aggregate(results, a) })) : []), [results]);
  const labels = (a: AlgorithmType) => ALGO_LABEL[a];
  const charts = useMemo(() => {
    if (!aggs.length) return null;
    return {
      avg: aggs.map(({ a, g }) => ({ algo: labels(a), reader: g.mean('avg_reader_wait_ms'), writer: g.mean('avg_writer_wait_ms') })),
      max: aggs.map(({ a, g }) => ({ algo: labels(a), reader: g.max('max_reader_wait_ms'), writer: g.max('max_writer_wait_ms') })),
      thr: aggs.map(({ a, g }) => ({ algo: labels(a), ops: g.mean('throughput_ops_per_sec') })),
      dur: aggs.map(({ a, g }) => ({ algo: labels(a), sec: g.mean('total_elapsed_ms') / 1000 })),
    };
  }, [aggs]);

  const facts = useMemo(() => {
    if (!aggs.length) return [];
    const best = (f: (g: Agg) => number, dir: 1 | -1) => aggs.reduce((p, c) => (dir * f(c.g) < dir * f(p.g) ? c : p));
    const w = best((g) => g.mean('max_writer_wait_ms'), -1);
    const r = best((g) => g.mean('max_reader_wait_ms'), -1);
    const t = best((g) => g.mean('throughput_ops_per_sec'), -1);
    return [
      `Longest writer wait (mean of per-run maxima): ${labels(w.a)}, ${fmtMs(w.g.mean('max_writer_wait_ms'))}.`,
      `Longest reader wait (mean of per-run maxima): ${labels(r.a)}, ${fmtMs(r.g.mean('max_reader_wait_ms'))}.`,
      `Highest throughput: ${labels(t.a)}, ${t.g.mean('throughput_ops_per_sec').toFixed(2)} operations per second.`,
    ];
  }, [aggs]);

  const rows: [string, (g: Agg) => string][] = [
    ['Average reader wait', (g) => spread(g, 'avg_reader_wait_ms')],
    ['Average writer wait', (g) => spread(g, 'avg_writer_wait_ms')],
    ['Longest reader wait', (g) => spread(g, 'max_reader_wait_ms')],
    ['Longest writer wait', (g) => spread(g, 'max_writer_wait_ms')],
    ['Reads completed', (g) => `${g.mean('completed_reads').toFixed(0)}`],
    ['Writes completed', (g) => `${g.mean('completed_writes').toFixed(0)}`],
    ['Throughput (ops/s)', (g) => g.mean('throughput_ops_per_sec').toFixed(2)],
    ['Total duration', (g) => fmtMs(g.mean('total_elapsed_ms'))],
    ['Final value / version', (g) => `${g.value} / v${g.version}`],
    ['Starvation warnings', (g) => `${g.starved} of ${g.runs} run${g.runs === 1 ? '' : 's'}`],
  ];
  function spread(g: Agg, k: keyof Metrics) {
    const m = fmtMs(g.mean(k));
    return g.runs > 1 ? `${m}  (${fmtMs(g.min(k))} to ${fmtMs(g.max(k))})` : m;
  }

  return (
    <div className="page">
      <PageHead
        title={<Letters text="Same load. Three policies." />}
        sub="Every algorithm runs your exact workload, so the differences are the algorithm and nothing else. Threads are nondeterministic, so repeat runs and read the spread."
      />
      <section className="section" aria-labelledby="vs-h">
        <header><h2 id="vs-h">Workload</h2><a className="mono" href="#/lab">edit it in the Lab</a></header>
        <div className="run-bar" style={{ paddingTop: 20 }}>
          <p style={{ flex: '1 1 320px', fontFamily: 'var(--serif)', fontSize: 19, lineHeight: 1.5, maxWidth: '52ch' }}>
            {draft.reader_count} readers ({draft.read_duration_ms} ms) and {draft.writer_count} writers ({draft.write_duration_ms} ms), one request every {draft.stagger_arrivals_ms} ms.
            Each write does {draft.writer_op.toLowerCase()} {draft.writer_amount} to {draft.initial_value}.
          </p>
          <div className="field" style={{ minWidth: 180 }}>
            <span className="lab"><span>Repeat runs</span></span>
            <div className="seg" role="radiogroup" aria-label="Number of repeated runs">
              {[1, 3, 5].map((n) => (<button key={n} role="radio" aria-checked={runs === n} disabled={!!busy} onClick={() => setRuns(n)}>{n}×</button>))}
            </div>
          </div>
          <button className="btn primary" onClick={go} disabled={!!busy || live} title={live ? 'Stop the live run first so timings are clean' : undefined}>
            {busy ? `Run ${busy.i} of ${busy.n}…` : 'Run the showdown'}
          </button>
          {busy && <div className="indet" role="progressbar" aria-label="Comparison in progress"><i /></div>}
        </div>
        {live && <p className="lock-note" style={{ margin: '16px 0 0' }}>A live run is using the CPU. Stop it first for clean timings.</p>}
      </section>

      {!results.length && !busy && (
        <div className="panel"><div className="empty"><EmptyMark /><h3>No showdown yet</h3><p>Pick a scenario in the Lab (try “Starve the writer”), then run it here against all three algorithms.</p></div></div>
      )}

      {aggs.length > 0 && charts && (
        <>
          <p className="mono" aria-live="polite">{results.length} run{results.length === 1 ? '' : 's'} per algorithm · workload: {workload.reader_count}R / {workload.writer_count}W</p>
          <div className="versus-grid">
            {aggs.map(({ a, g }) => (
              <section className="contender" key={a} aria-label={labels(a)}>
                <header><h3>{labels(a)}</h3><span className="mono">{ALGO_SHORT[a]}</span></header>
                <div className="body">
                  <div className="pair-stats">
                    <div className="stat"><span className="v num" style={{ color: 'var(--read-ink)' }}>{fmtMs(g.mean('avg_reader_wait_ms'))}</span><span className="l"><span className="dot r" />avg reader wait</span></div>
                    <div className="stat"><span className="v num">{fmtMs(g.mean('avg_writer_wait_ms'))}</span><span className="l"><span className="dot w" />avg writer wait</span></div>
                  </div>
                  {g.starved > 0 ? (
                    <div className="banner warn"><span>Starvation warning in {g.starved} of {g.runs} run{g.runs === 1 ? '' : 's'}.</span></div>
                  ) : (
                    <span className="muted">No starvation warning in any run.</span>
                  )}
                </div>
              </section>
            ))}
          </div>
          <div className="charts">
            <Chart title="Average wait" note="How long a request waited before it was admitted, in ms." data={charts.avg} unit="ms" series={[{ key: 'reader', name: 'Readers', color: 'var(--read)' }, { key: 'writer', name: 'Writers', color: 'var(--write)' }]} />
            <Chart title="Longest wait" note="The worst single wait seen in any run, in ms. This is where starvation shows." data={charts.max} unit="ms" series={[{ key: 'reader', name: 'Readers', color: 'var(--read)' }, { key: 'writer', name: 'Writers', color: 'var(--write)' }]} />
            <Chart title="Throughput" note="Completed operations per second." data={charts.thr} unit="ops/s" series={[{ key: 'ops', name: 'Operations per second', color: 'var(--wait)' }]} />
            <Chart title="Total duration" note="Seconds from first request to last release." data={charts.dur} unit="s" series={[{ key: 'sec', name: 'Seconds', color: 'var(--wait)' }]} />
          </div>
          <section className="section" aria-labelledby="tbl-h">
            <header><h2 id="tbl-h">Numbers behind the charts</h2><span className="mono">mean across {results.length} run{results.length === 1 ? '' : 's'}{results.length > 1 ? ', range in brackets' : ''}</span></header>
            <div style={{ overflowX: 'auto' }}>
              <table className="tbl cmp">
                <thead><tr><th>Measure</th>{ALGOS.map((a) => <th key={a}>{labels(a)}</th>)}</tr></thead>
                <tbody>
                  {rows.map(([name, f]) => (<tr key={name}><td><strong>{name}</strong></td>{aggs.map(({ a, g }) => <td key={a} className="num">{f(g)}</td>)}</tr>))}
                </tbody>
              </table>
            </div>
            <div style={{ paddingTop: 22 }}>
              <ul style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 6, fontFamily: 'var(--serif)', fontSize: 17 }}>{facts.map((f) => <li key={f}>{f}</li>)}</ul>
              <p className="muted" style={{ marginTop: 10, fontSize: 13 }}>No algorithm is faster in general. These figures describe this workload on this machine.</p>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

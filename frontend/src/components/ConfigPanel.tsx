import { useActions, useSync } from '../store';
import { LIMITS, PRESETS, configErrors } from '../lib/presets';
import type { AlgorithmType, SimConfig, WriterOp } from '../types';

const ALGOS: { id: AlgorithmType; name: string; line: string }[] = [
  { id: 'reader_preference', name: 'Reader preference', line: 'Readers share. Writers can starve.' },
  { id: 'writer_preference', name: 'Writer preference', line: 'A waiting writer blocks new readers.' },
  { id: 'fair_fifo', name: 'Fair FIFO', line: 'Strict arrival order. Nobody starves.' },
];

const OPS: { id: WriterOp; label: string; sym: string }[] = [
  { id: 'ADD', label: 'Add', sym: '+' },
  { id: 'SUBTRACT', label: 'Subtract', sym: '−' },
  { id: 'MULTIPLY', label: 'Multiply', sym: '×' },
  { id: 'SET', label: 'Set to', sym: '=' },
];

type NumKey = keyof typeof LIMITS;

function NumField({ k, label, hint, unit, step = 1, cfg, errs, locked, onChange, slider = true }: {
  k: NumKey; label: string; hint?: string; unit?: string; step?: number; cfg: SimConfig;
  errs: Partial<Record<NumKey, string>>; locked: boolean; onChange: (p: Partial<SimConfig>) => void; slider?: boolean;
}) {
  const [lo, hi] = LIMITS[k];
  const id = `f-${k}`;
  const v = cfg[k];
  return (
    <div className="field">
      <label htmlFor={id}>
        <span>{label}</span>
        {errs[k] ? <span className="err">Use {errs[k]}</span> : hint ? <span className="hint">{hint}</span> : null}
      </label>
      <div className="pair">
        {slider ? (
          <input
            type="range" min={lo} max={hi} step={step} value={Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : lo}
            disabled={locked} aria-label={`${label} slider`}
            style={{ ['--pct' as string]: `${Number.isFinite(v) ? ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * 100 : 0}%` }}
            onChange={(e) => onChange({ [k]: Number(e.target.value) } as Partial<SimConfig>)}
          />
        ) : (
          <span />
        )}
        <input
          id={id} type="number" min={lo} max={hi} step={step} value={Number.isFinite(v) ? v : ''} disabled={locked}
          aria-invalid={!!errs[k]}
          onChange={(e) => onChange({ [k]: e.target.value === '' ? NaN : Number(e.target.value) } as Partial<SimConfig>)}
        />
      </div>
      {unit && <span className="hint" style={{ textAlign: 'right' }}>{unit}</span>}
    </div>
  );
}

export function ConfigPanel() {
  const { draft, sim } = useSync();
  const { setDraft, replaceDraft } = useActions();
  const locked = sim?.status === 'RUNNING' || sim?.status === 'PAUSED';
  const errs = configErrors(draft);
  const props = { cfg: draft, errs, locked, onChange: setDraft };
  return (
    <>
      <section className="section" aria-labelledby="cfg-h">
        <header><h2 id="cfg-h">Experiment</h2></header>
        <div style={{ paddingTop: 18 }}>
          {locked && <p className="lock-note">Locked while a run is live. Stop it to edit.</p>}
          <div className="algo" role="radiogroup" aria-label="Synchronization algorithm">
            {ALGOS.map((a) => (
              <button
                key={a.id} role="radio" aria-checked={draft.algorithm === a.id} disabled={locked} className="algo-opt"
                onClick={() => setDraft({ algorithm: a.id })}
              >
                <b>{a.name}</b>
                <span>{a.line}</span>
              </button>
            ))}
          </div>
          <div className="fields">
            <NumField k="reader_count" label="Readers" hint="1 to 100" {...props} />
            <NumField k="writer_count" label="Writers" hint="1 to 50" {...props} />
            <NumField k="read_duration_ms" label="Read takes" unit="milliseconds" step={50} {...props} />
            <NumField k="write_duration_ms" label="Write takes" unit="milliseconds" step={50} {...props} />
            <NumField k="stagger_arrivals_ms" label="Arrival gap" hint="between requests" unit="milliseconds" step={10} {...props} />
            <div className="field">
              <span className="lab"><span>Each write does</span></span>
              <div className="seg" role="radiogroup" aria-label="Writer operation">
                {OPS.map((o) => (
                  <button key={o.id} role="radio" aria-checked={draft.writer_op === o.id} disabled={locked} onClick={() => setDraft({ writer_op: o.id })} title={o.label}>
                    {o.sym} {o.label}
                  </button>
                ))}
              </div>
            </div>
            <NumField k="writer_amount" label="Amount" slider={false} {...props} />
            <NumField k="initial_value" label="Starting value" slider={false} {...props} />
            <NumField k="max_duration_sec" label="Time limit" unit="seconds" step={5} {...props} />
          </div>
        </div>
      </section>
      <section className="section" aria-labelledby="pre-h">
        <header style={{ borderBottom: 0, paddingBottom: 6 }}><h2 id="pre-h">Scenarios</h2></header>
        <div className="presets">
          {PRESETS.map((p) => (
            <button key={p.id} className="preset" disabled={locked} onClick={() => replaceDraft(p.config)}>
              <b>{p.name}</b>
              <span>{p.blurb}</span>
            </button>
          ))}
        </div>
      </section>
    </>
  );
}

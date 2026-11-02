import { useMemo } from 'react';
import { useSync } from '../store';
import { fmtNum } from '../lib/format';
import type { ProcessInfo } from '../types';

function Pill({ p, kind }: { p: ProcessInfo; kind: 'r' | 'w' | 'q' }) {
  const round = p.process_type === 'READER';
  return (
    <span className={`pill ${kind}`} style={kind === 'q' && round ? { borderRadius: 999 } : undefined} title={`${p.id} · ${p.state.toLowerCase()}`}>
      {p.id}
    </span>
  );
}

export function ResourceCore() {
  const { sim } = useSync();
  const view = useMemo(() => {
    if (!sim) return null;
    const waiting = sim.processes
      .filter((p) => p.state === 'WAITING')
      .sort((a, b) => (a.requested_at ?? 0) - (b.requested_at ?? 0));
    const readers = sim.processes.filter((p) => p.state === 'READING');
    const writer = sim.processes.find((p) => p.state === 'WRITING') ?? null;
    return { waiting, readers, writer };
  }, [sim]);

  const mode = view?.writer ? 'write' : view && view.readers.length ? 'read' : 'idle';
  const val = sim ? fmtNum(sim.resource_value) : '–';
  const big = val.length > 9 ? 0.42 : val.length > 6 ? 0.62 : val.length > 4 ? 0.8 : 1;
  const shownWaiting = view ? view.waiting.slice(0, 18) : [];
  const hidden = view ? view.waiting.length - shownWaiting.length : 0;
  const waitingWriters = view ? view.waiting.filter((p) => p.process_type === 'WRITER').length : 0;

  let line = 'Nobody holds the register.';
  if (mode === 'read') line = `${view!.readers.length} reader${view!.readers.length === 1 ? '' : 's'} sharing. Writers are locked out.`;
  if (mode === 'write') line = `${view!.writer!.id} has it alone. Everyone else waits.`;
  if (sim && mode === 'idle' && sim.status === 'COMPLETED') line = 'Run finished. The register is free.';

  return (
    <section className="panel core" data-mode={mode} aria-labelledby="core-h">
      <div className="panel-head">
        <h2 id="core-h">Shared register</h2>
        <span className="mono">{sim ? sim.algorithm.replace(/_/g, ' ') : 'no run'}</span>
      </div>
      <div className="core-stage">
        <div className="room">
          <h3>
            <span>Waiting room</span>
            <span className="mono">{view?.waiting.length ?? 0} queued · {waitingWriters} writer{waitingWriters === 1 ? '' : 's'}</span>
          </h3>
          <div className="queue" aria-live="off">
            {view && view.waiting.length === 0 && <span className="muted" style={{ fontSize: 14 }}>Nobody is waiting.</span>}
            {shownWaiting.map((p) => <Pill key={p.id} p={p} kind="q" />)}
            {hidden > 0 && <span className="pill more">+{hidden}</span>}
          </div>
          <div className="door">Oldest request on the left. Admission order depends on the algorithm.</div>
        </div>
        <div className="vault">
          <div className="bus">
            <h3>
              <span>Inside, reading</span>
              <span className="mono">{view?.readers.length ?? 0}</span>
            </h3>
            <div className="rail-line">
              {view && view.readers.length === 0 && <span className="muted" style={{ fontSize: 14 }}>No readers.</span>}
              {view?.readers.slice(0, 24).map((p) => <Pill key={p.id} p={p} kind="r" />)}
              {view && view.readers.length > 24 && <span className="pill more">+{view.readers.length - 24}</span>}
            </div>
          </div>
          <div className="register">
            <span className="jaw l" /><span className="jaw r" />
            <div key={sim?.resource_version ?? 0} className={`reg-val num ${sim && sim.resource_version > 0 ? 'pop' : ''}`} style={{ fontSize: `calc(clamp(72px, 9vw, 140px) * ${big})` }} aria-label={`Resource value ${val}`}>
              {val}
            </div>
            <div className="reg-meta">
              <span className="badge num">version {sim?.resource_version ?? 0}</span>
              {view?.writer && (
                <span style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 140 }}>
                  <span className="pill w">{view.writer.id}</span>
                  <span className="prog"><i style={{ width: `${view.writer.progress_pct}%` }} /></span>
                </span>
              )}
            </div>
          </div>
          <div className="mode-line" aria-live="polite">
            <span>{line}</span>
            <span className="mono">{mode === 'write' ? 'exclusive' : mode === 'read' ? 'shared' : 'free'}</span>
          </div>
        </div>
      </div>
    </section>
  );
}

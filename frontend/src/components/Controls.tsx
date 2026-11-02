import { useActions, useSync } from '../store';
import { IconPause, IconPlay, IconReset, IconStop } from './Icons';

export function Controls() {
  const { sim, busy, conn } = useSync();
  const a = useActions();
  const status = sim?.status ?? 'IDLE';
  const offline = conn === 'offline' || conn === 'connecting';
  const live = status === 'RUNNING' || status === 'PAUSED';
  return (
    <div className="controls" role="group" aria-label="Simulation controls">
      {!live && (
        <button className="btn primary" onClick={a.launch} disabled={busy || offline} title="Space">
          <IconPlay /> Launch
        </button>
      )}
      {status === 'RUNNING' && (
        <button className="btn warn" onClick={a.pause} title="Space">
          <IconPause /> Pause
        </button>
      )}
      {status === 'PAUSED' && (
        <button className="btn primary" onClick={a.resume} title="Space">
          <IconPlay /> Resume
        </button>
      )}
      <button className="btn danger" onClick={a.stop} disabled={!live} title="S">
        <IconStop /> Stop
      </button>
      <button className="btn" onClick={a.reset} disabled={busy || offline || status === 'IDLE'} title="R">
        <IconReset /> Reset
      </button>
    </div>
  );
}

const STATUS_COPY: Record<string, string> = {
  IDLE: 'Ready',
  RUNNING: 'Running',
  PAUSED: 'Paused',
  COMPLETED: 'Finished',
  CANCELLED: 'Stopped',
  ERROR: 'Error',
};

export function StatusSticker() {
  const { sim } = useSync();
  const s = sim?.status ?? 'IDLE';
  return (
    <span className="status" data-s={s} role="status" aria-live="polite">
      <i aria-hidden="true" />
      {STATUS_COPY[s] ?? s}
      {sim ? <span className="mono">run {sim.simulation_id}</span> : null}
    </span>
  );
}

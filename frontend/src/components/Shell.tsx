import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { ConnState, SimEvent, ViewId } from '../types';
import { useActions, useSync } from '../store';
import { BrandMark, IconMoon, IconSun, NavIcon } from './Icons';

export const NAV: { id: ViewId; label: string; hint: string }[] = [
  { id: 'lab', label: 'Lab', hint: 'Configure and run' },
  { id: 'trace', label: 'Trace', hint: 'Lanes and event log' },
  { id: 'versus', label: 'Versus', hint: 'Compare algorithms' },
  { id: 'report', label: 'Report', hint: 'Results and export' },
  { id: 'learn', label: 'Learn', hint: 'How it works' },
];

export function useTheme(): [string, () => void] {
  const [theme, setTheme] = useState<string>(() => {
    try {
      return localStorage.getItem('synclab.theme') ?? 'light';
    } catch {
      return 'light';
    }
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('synclab.theme', theme);
    } catch {
      /* ignore */
    }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
}

export function Rail({ view, onNav }: { view: ViewId; onNav: (v: ViewId) => void }) {
  const [theme, toggle] = useTheme();
  return (
    <aside className="rail">
      <a className="brand" href="#/lab" aria-label="SyncLab home">
        <BrandMark />
        <span>SyncLab</span>
      </a>
      <nav className="nav" aria-label="Main">
        {NAV.map((n, i) => (
          <a
            key={n.id}
            href={`#/${n.id}`}
            aria-current={view === n.id ? 'page' : undefined}
            title={`${n.hint} (${i + 1})`}
            onClick={(e) => {
              e.preventDefault();
              onNav(n.id);
            }}
          >
            <NavIcon id={n.id} />
            {n.label}
          </a>
        ))}
      </nav>
      <div className="rail-foot">
        <button className="theme-btn" onClick={toggle} aria-label={`Switch to ${theme === 'dark' ? 'day' : 'night'} theme`}>
          {theme === 'dark' ? <IconSun /> : <IconMoon />}
          {theme === 'dark' ? 'Day' : 'Night'}
        </button>
        <div className="keys">
          <kbd>Space</kbd> run
          <br />
          <kbd>S</kbd> stop <kbd>R</kbd> reset
        </div>
      </div>
    </aside>
  );
}

function tapeText(e: SimEvent): string {
  return e.details || e.event_type;
}

export function Tape() {
  const { events, sim } = useSync();
  const items = useMemo(() => events.slice(-14).reverse(), [events]);
  const idle = items.length === 0;
  const dur = Math.max(24, (idle ? 3 : items.length) * 7);
  const row = (suffix: string) =>
    idle ? (
      <span className="tape-item" key={suffix}>
        <b>standby</b> Nothing has run yet. Pick an algorithm, then press Launch.
        <b>standby</b> Every number on this screen comes from the backend.
        <b>standby</b> Space starts and pauses.
      </span>
    ) : (
      items.map((e) => (
        <span className="tape-item" key={`${suffix}${e.seq}`}>
          <b>#{e.seq}</b>
          {(e.timestamp_rel_ms / 1000).toFixed(2)}s
          <span>{tapeText(e)}</span>
        </span>
      ))
    );
  return (
    <div className="tape" aria-label="Latest events" data-status={sim?.status}>
      <div className="tape-track" style={{ ['--dur' as string]: `${dur}s` }}>
        {row('a')}
        <span aria-hidden="true" style={{ display: 'contents' }}>{row('b')}</span>
      </div>
    </div>
  );
}

const CONN_TEXT: Record<ConnState, string> = {
  connecting: 'Connecting',
  live: 'Live',
  retrying: 'Reconnecting',
  offline: 'Backend offline',
};

export function ConnChip() {
  const { conn } = useSync();
  return (
    <span className="conn" data-c={conn} role="status">
      <i />
      {CONN_TEXT[conn]}
    </span>
  );
}

export function Toasts() {
  const { toasts } = useSync();
  const { dismissToast } = useActions();
  return (
    <div className="toasts" aria-live="polite">
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.kind}`} role={t.kind === 'error' ? 'alert' : 'status'}>
          <span>{t.text}</span>
          <button onClick={() => dismissToast(t.id)} aria-label="Dismiss">
            ×
          </button>
        </div>
      ))}
    </div>
  );
}

export function OfflineCard() {
  const { conn } = useSync();
  if (conn !== 'offline') return null;
  return (
    <div className="offline-card" role="alert">
      <h2>The backend isn&apos;t answering.</h2>
      <p>SyncLab keeps retrying. Start the API from the project folder, then this screen reconnects by itself:</p>
      <code>cd backend &amp;&amp; python -m uvicorn app.main:app --host 127.0.0.1 --port 8000</code>
    </div>
  );
}

export function PageHead({ title, sub, children }: { title: ReactNode; sub?: ReactNode; children?: ReactNode }) {
  return (
    <header className="page-head">
      <div>
        <h1 className="title">{title}</h1>
        {sub && <p className="sub">{sub}</p>}
      </div>
      {children && <div className="head-side">{children}</div>}
    </header>
  );
}

/** Headline set one sentence per line; each line rises into place once when the view opens. */
export function Letters({ text }: { text: string }) {
  const lines = text.split(/(?<=[.?!])\s+/);
  return (
    <>
      {lines.map((l, i) => (
        <span className="line" key={l}>
          <span style={{ ['--i' as string]: i }}>{l}</span>
        </span>
      ))}
    </>
  );
}

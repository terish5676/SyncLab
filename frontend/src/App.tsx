import { useCallback, useEffect, useState } from 'react';
import { Rail, Tape, Toasts } from './components/Shell';
import { SyncProvider, useActions, useSync } from './store';
import { Lab } from './views/Lab';
import { Trace } from './views/Trace';
import { Versus } from './views/Versus';
import { Report } from './views/Report';
import { Learn } from './views/Learn';
import { NAV } from './components/Shell';
import type { ViewId } from './types';

const IDS = NAV.map((n) => n.id);

function parseHash(): ViewId {
  const h = location.hash.replace(/^#\/?/, '') as ViewId;
  return IDS.includes(h) ? h : 'lab';
}

function Shortcuts() {
  const { sim, busy } = useSync();
  const a = useActions();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (t.closest('input, select, textarea, [contenteditable]')) return;
      const status = sim?.status ?? 'IDLE';
      if (e.code === 'Space' && !t.closest('button, a, [role="radio"]')) {
        e.preventDefault();
        if (status === 'RUNNING') a.pause();
        else if (status === 'PAUSED') a.resume();
        else if (!busy) a.launch();
      } else if (e.key === 's' || e.key === 'S') {
        if (status === 'RUNNING' || status === 'PAUSED') a.stop();
      } else if (e.key === 'r' || e.key === 'R') {
        if (!busy && status !== 'IDLE') a.reset();
      } else if (/^[1-5]$/.test(e.key)) {
        location.hash = `#/${IDS[Number(e.key) - 1]}`;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [sim?.status, busy, a]);
  return null;
}

function Routes({ view }: { view: ViewId }) {
  switch (view) {
    case 'trace': return <Trace />;
    case 'versus': return <Versus />;
    case 'report': return <Report />;
    case 'learn': return <Learn />;
    default: return <Lab />;
  }
}

export default function App() {
  const [view, setView] = useState<ViewId>(parseHash);
  useEffect(() => {
    const on = () => { setView(parseHash()); window.scrollTo({ top: 0 }); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  const nav = useCallback((v: ViewId) => { location.hash = `#/${v}`; }, []);
  useEffect(() => {
    document.title = `${NAV.find((n) => n.id === view)?.label ?? 'Lab'} · SyncLab`;
  }, [view]);
  return (
    <SyncProvider>
      <Shortcuts />
      <button className="skip" onClick={() => document.getElementById('main')?.focus()}>Skip to content</button>
      <div className="app">
        <Rail view={view} onNav={nav} />
        <div className="main">
          <Tape />
          <main id="main" tabIndex={-1}><Routes view={view} /></main>
        </div>
      </div>
      <Toasts />
    </SyncProvider>
  );
}

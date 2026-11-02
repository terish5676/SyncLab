import { useMemo, useState } from 'react';
import { useActions, useSync } from '../store';
import { fmtMs } from '../lib/format';
import type { ProcessInfo } from '../types';
import { EmptyMark, STATE_WORD, StateGlyph } from './Icons';

type Filter = 'all' | 'active' | 'waiting' | 'done';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'All' }, { id: 'active', label: 'Inside' }, { id: 'waiting', label: 'Waiting' }, { id: 'done', label: 'Done' },
];

function matches(p: ProcessInfo, f: Filter): boolean {
  if (f === 'all') return true;
  if (f === 'active') return p.state === 'READING' || p.state === 'WRITING';
  if (f === 'waiting') return p.state === 'WAITING';
  return p.state === 'COMPLETED' || p.state === 'CANCELLED' || p.state === 'ERROR';
}

function Tag({ p, dense }: { p: ProcessInfo; dense: boolean }) {
  const { focus } = useActions();
  const showProg = p.state === 'READING' || p.state === 'WRITING';
  const wait = p.state === 'CREATED' ? '' : fmtMs(p.wait_time_ms);
  return (
    <button
      className="tag" data-s={p.state}
      onClick={() => { focus(p.id); location.hash = '#/trace'; }}
      title={`${p.id} · ${STATE_WORD[p.state]}${wait ? ` · waited ${wait}` : ''} — open in trace`}
      aria-label={`${p.id} ${STATE_WORD[p.state]}${wait ? `, waited ${wait}` : ''}`}
    >
      <span className="row">
        <span className="id">{p.id}</span>
        <StateGlyph state={p.state} />
      </span>
      {!dense && (
        <>
          <span className="meta">
            <span className="state-word">{STATE_WORD[p.state]}</span>
            <span className="num">{p.state === 'WAITING' || p.state === 'CREATED' ? '' : `waited ${wait}`}</span>
          </span>
          {showProg && <span className="prog"><i style={{ width: `${p.progress_pct}%` }} /></span>}
        </>
      )}
    </button>
  );
}

export function ProcessFloor() {
  const { sim } = useSync();
  const [filter, setFilter] = useState<Filter>('all');
  const procs = sim?.processes ?? [];
  const readers = useMemo(() => procs.filter((p) => p.process_type === 'READER' && matches(p, filter)), [procs, filter]);
  const writers = useMemo(() => procs.filter((p) => p.process_type === 'WRITER' && matches(p, filter)), [procs, filter]);
  const dense = procs.length > 40;
  const totalR = procs.filter((p) => p.process_type === 'READER').length;
  const totalW = procs.length - totalR;
  return (
    <section className="section" aria-labelledby="floor-h">
      <header>
        <h2 id="floor-h">Process floor</h2>
        <div className="chips" role="group" aria-label="Filter processes">
          {FILTERS.map((f) => (
            <button key={f.id} className="chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>{f.label}</button>
          ))}
        </div>
      </header>
      {procs.length === 0 ? (
        <div className="empty"><EmptyMark /><h3>No processes yet</h3><p>Launch a run and every reader and writer thread shows up here with its real state.</p></div>
      ) : (
        <div className="floor">
          <div className="floor-col">
            <h3><span>Readers</span><span className="mono">{readers.length} of {totalR}</span></h3>
            <div className={`tags ${dense ? 'dense' : ''}`}>{readers.map((p) => <Tag key={p.id} p={p} dense={dense} />)}</div>
            {readers.length === 0 && <p className="muted">None match this filter.</p>}
          </div>
          <div className="floor-col">
            <h3><span>Writers</span><span className="mono">{writers.length} of {totalW}</span></h3>
            <div className={`tags ${dense ? 'dense' : ''}`}>{writers.map((p) => <Tag key={p.id} p={p} dense={dense} />)}</div>
            {writers.length === 0 && <p className="muted">None match this filter.</p>}
          </div>
        </div>
      )}
    </section>
  );
}

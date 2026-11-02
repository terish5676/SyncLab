import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { useActions, useSync } from '../store';
import type { SimEvent } from '../types';
import { EmptyMark, IconDown } from './Icons';

type Filter = 'all' | 'readers' | 'writers' | 'locks' | 'warnings' | 'errors';
const LOCK = new Set(['PROCESS_REQUESTED', 'READ_ACQUIRED', 'WRITE_ACQUIRED', 'READ_RELEASED', 'WRITE_COMMITTED']);
const WARN = new Set(['TIMEOUT', 'PROCESS_CANCELLED', 'SIMULATION_STOPPED', 'SIMULATION_PAUSED']);
const ERR = new Set(['INVARIANT_VIOLATION', 'PROCESS_ERROR']);

const TESTS: Record<Filter, (e: SimEvent) => boolean> = {
  all: () => true,
  readers: (e) => e.process_type === 'READER',
  writers: (e) => e.process_type === 'WRITER',
  locks: (e) => LOCK.has(e.event_type),
  warnings: (e) => WARN.has(e.event_type),
  errors: (e) => ERR.has(e.event_type),
};
const LABEL: Record<Filter, string> = { all: 'All', readers: 'Readers', writers: 'Writers', locks: 'Lock activity', warnings: 'Warnings', errors: 'Errors' };

function kind(e: SimEvent): 'r' | 'w' | 'q' | 'x' {
  if (ERR.has(e.event_type)) return 'x';
  if (e.process_type === 'READER') return 'r';
  if (e.process_type === 'WRITER') return 'w';
  return 'q';
}

const LIMIT = 400;

export function EventLog() {
  const { events, focusId } = useSync();
  const { focus } = useActions();
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [follow, setFollow] = useState(true);
  const [all, setAll] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  const counts = useMemo(() => {
    const c = {} as Record<Filter, number>;
    (Object.keys(TESTS) as Filter[]).forEach((f) => (c[f] = events.filter(TESTS[f]).length));
    return c;
  }, [events]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return events.filter((e) => {
      if (!TESTS[filter](e)) return false;
      if (focusId && e.process_id !== focusId) return false;
      if (!q) return true;
      return `${e.process_id ?? ''} ${e.event_type} ${e.details}`.toLowerCase().includes(q);
    });
  }, [events, filter, query, focusId]);
  const shown = all ? rows : rows.slice(-LIMIT);

  useEffect(() => {
    if (follow && box.current) box.current.scrollTop = box.current.scrollHeight;
  }, [shown.length, follow]);

  return (
    <section className="panel" aria-labelledby="log-h">
      <div className="panel-head">
        <h2 id="log-h">Event log</h2>
        <div className="chips" role="group" aria-label="Filter events">
          {(Object.keys(LABEL) as Filter[]).map((f) => (
            <button key={f} className="chip" aria-pressed={filter === f} onClick={() => setFilter(f)}>{LABEL[f]} <span className="num">{counts[f]}</span></button>
          ))}
        </div>
      </div>
      <div className="log-tools">
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input className="search" type="search" placeholder="Search process, event or text" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search events" />
          {focusId && <button className="chip" aria-pressed="true" onClick={() => focus(null)}>Only {focusId} ×</button>}
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 600, fontSize: 13 }}>
            <input type="checkbox" checked={follow} onChange={(e) => setFollow(e.target.checked)} /> Follow newest
          </label>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <a className="btn sm" href={api.exportUrl('csv')} download><IconDown /> CSV</a>
          <a className="btn sm" href={api.exportUrl('json')} download><IconDown /> JSON</a>
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="empty"><EmptyMark /><h3>{events.length ? 'No events match' : 'No events yet'}</h3><p>{events.length ? 'Clear the search or pick another filter.' : 'Launch a run from the Lab. Each lock acquire and release lands here in order.'}</p></div>
      ) : (
        <>
          <div className="log-scroll" ref={box} tabIndex={0} aria-label="Event table">
            <table className="tbl">
              <thead><tr><th>#</th><th className="r">Time</th><th>Who</th><th>Event</th><th>State</th><th className="r">Value</th><th className="r">R / W in</th><th>What happened</th></tr></thead>
              <tbody>
                {shown.map((e) => (
                  <tr key={e.seq}>
                    <td className="m">{e.seq}</td>
                    <td className="m r">{(e.timestamp_rel_ms / 1000).toFixed(3)}s</td>
                    <td>{e.process_id ? <span className="ev-pill" data-k={kind(e)}>{e.process_id}</span> : <span className="muted">system</span>}</td>
                    <td className="ev">{e.event_type}</td>
                    <td className="m">{e.from_state && e.to_state ? `${e.from_state} → ${e.to_state}` : ''}</td>
                    <td className="m r">{e.resource_value} · v{e.resource_version}</td>
                    <td className="m r">{e.active_readers} / {e.active_writers}</td>
                    <td>{e.details}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > LIMIT && (
            <div className="log-tools" style={{ borderTop: '1px solid var(--line)', borderBottom: 0 }}>
              <span className="muted">Showing {shown.length} of {rows.length} events.</span>
              <button className="btn sm" onClick={() => setAll((a) => !a)}>{all ? 'Show latest only' : 'Show all'}</button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

import { useSync } from '../store';

function Switch({ held, on = 'HELD', off = 'FREE' }: { held: boolean; on?: string; off?: string }) {
  return (
    <span className="switch" data-held={held} role="img" aria-label={held ? on : off}>
      <span className="on">{on}</span>
      <span className="off">{off}</span>
    </span>
  );
}

export function SemaphoreBoard() {
  const { sim } = useSync();
  if (!sim) return (
    <section className="section"><header><h2>Semaphores</h2></header><div style={{ paddingTop: 16, display: 'grid', gap: 12 }} aria-busy="true"><div className="skel" style={{ height: 44 }} /><div className="skel" style={{ height: 44 }} /><div className="skel" style={{ height: 44 }} /><span className="muted">Waiting for the backend.</span></div></section>
  );
  const s = sim.semaphores;
  const writer = sim.active_writer_id;
  const readers = sim.active_reader_ids.length;
  const held = !!writer || readers > 0;
  const holder = writer ? `held by ${writer}` : readers ? `held by the reader group (${readers})` : 'nobody holds it';
  const algo = sim.algorithm;
  return (
    <section className="section" aria-labelledby="sem-h">
      <header><h2 id="sem-h">Semaphores</h2><span className="mono">live</span></header>
      <div className="sems">
        <div className="sem">
          <b>resource lock</b>
          <small>{holder}</small>
          <span className="val"><Switch held={held} /></span>
        </div>
        <div className="sem">
          <b>read_count</b>
          <small>readers inside the group</small>
          <span className="val num">{s.read_count}</span>
        </div>
        {algo === 'writer_preference' && (
          <>
            <div className="sem">
              <b>read_try gate</b>
              <small>closed while any writer is queued or active</small>
              <span className="val"><Switch held={s.read_try_locked} on="CLOSED" off="OPEN" /></span>
            </div>
            <div className="sem">
              <b>write_count</b>
              <small>writers queued or inside</small>
              <span className="val num">{s.write_count}</span>
            </div>
          </>
        )}
        {algo === 'fair_fifo' && (
          <div className="sem">
            <b>ticket queue</b>
            <small>requests still in line to be admitted</small>
            <span className="val"><Switch held={s.turnstile_busy} on="BUSY" off="EMPTY" /></span>
          </div>
        )}
        <div className="sem">
          <b>waiting readers</b>
          <small>blocked at the entry protocol</small>
          <span className="val num">{s.waiting_readers}</span>
        </div>
        <div className="sem">
          <b>waiting writers</b>
          <small>blocked at the entry protocol</small>
          <span className="val num">{s.waiting_writers}</span>
        </div>
      </div>
      <div className="policy">{s.admission_policy}</div>
    </section>
  );
}

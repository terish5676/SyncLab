import { Fragment } from 'react';
import { ALGOS, CONCEPTS } from '../lib/content';
import { PRESETS } from '../lib/presets';
import { Letters, PageHead } from '../components/Shell';
import { useActions, useSync } from '../store';

function Code({ src }: { src: string }) {
  return (
    <pre className="code" tabIndex={0}>
      {src.split('\n').map((line, i) => {
        const [code, ...comment] = line.split('#');
        return (
          <Fragment key={i}>
            {code}
            {comment.length > 0 && <span className="c">#{comment.join('#')}</span>}
            {'\n'}
          </Fragment>
        );
      })}
    </pre>
  );
}

export function Learn() {
  const { replaceDraft, toast } = useActions();
  const { sim } = useSync();
  const live = sim?.status === 'RUNNING' || sim?.status === 'PAUSED';
  const tryIt = (presetId: string) => {
    const p = PRESETS.find((x) => x.id === presetId);
    if (!p) return;
    if (live) return toast('error', 'Stop the live run first, then load the scenario.');
    replaceDraft(p.config);
    toast('ok', `Loaded “${p.name}”. Press Launch.`);
    location.hash = '#/lab';
  };
  return (
    <div className="page">
      <PageHead title={<Letters text="How it actually works." />} sub="Short explanations, the real pseudocode behind each algorithm, and a button that loads the scenario that shows each weakness." />
      <div className="learn">
        <nav className="toc" aria-label="Topics">
          <span className="grp">Ideas</span>
          {CONCEPTS.map((c) => (<a key={c.id} href={`#${c.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(c.id)?.scrollIntoView({ behavior: 'smooth' }); }}>{c.title}</a>))}
          <span className="grp">Algorithms</span>
          {ALGOS.map((a) => (<a key={a.id} href={`#${a.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(a.id)?.scrollIntoView({ behavior: 'smooth' }); }}>{a.title}</a>))}
          <a href="#compare" onClick={(e) => { e.preventDefault(); document.getElementById('compare')?.scrollIntoView({ behavior: 'smooth' }); }}>Side by side</a>
        </nav>
        <div className="lessons">
          {CONCEPTS.map((c) => (
            <section className="lesson" id={c.id} key={c.id}>
              <header><h2>{c.title}</h2></header>
              <div className="prose">{c.body.map((t, i) => <p key={i} dangerouslySetInnerHTML={{ __html: t }} />)}</div>
            </section>
          ))}
          {ALGOS.map((a) => (
            <section className="lesson" id={a.id} key={a.id}>
              <header>
                <h2>{a.title}</h2>
                <button className="btn sm" onClick={() => tryIt(a.preset)}>Try it in the Lab</button>
              </header>
              <div className="prose"><p><strong style={{ fontWeight: 500 }}>{a.idea}</strong></p></div>
              <div className="algo-sheet">
                <div>
                  <h4>Semaphores and variables</h4>
                  <ul>{a.semaphores.map((s) => <li key={s}>{s}</li>)}</ul>
                  <h4>Pseudocode</h4>
                  <Code src={a.code} />
                </div>
                <div>
                  <h4>Step by step</h4>
                  <ol style={{ margin: 0, paddingLeft: 20, display: 'grid', gap: 4 }}>{a.steps.map((s) => <li key={s}>{s}</li>)}</ol>
                  <h4>Small example</h4>
                  <p>{a.example}</p>
                  <h4>Good</h4>
                  <ul className="pros" style={{ padding: 0, margin: 0 }}>{a.pros.map((s) => <li key={s}>{s}</li>)}</ul>
                  <h4>Bad</h4>
                  <ul className="pros con" style={{ padding: 0, margin: 0 }}>{a.cons.map((s) => <li key={s}>{s}</li>)}</ul>
                </div>
              </div>
              <div className="prose" style={{ paddingTop: 22 }}>
                <p><strong>Starvation.</strong> {a.starvation}</p>
                <p><strong>Invariants it must keep.</strong></p>
                <ul style={{ fontFamily: 'var(--sans)', fontSize: 15 }}>{a.invariants.map((s) => <li key={s}>{s}</li>)}</ul>
              </div>
            </section>
          ))}
          <section className="lesson" id="compare">
            <header><h2>Side by side</h2></header>
            <div style={{ overflowX: 'auto' }}>
              <table className="cmp">
                <thead><tr><th /><th>Reader preference</th><th>Writer preference</th><th>Fair FIFO</th></tr></thead>
                <tbody>
                  <tr><th>Readers share</th><td>Yes</td><td>Yes</td><td>Yes, when adjacent in line</td></tr>
                  <tr><th>Writer exclusive</th><td>Yes</td><td>Yes</td><td>Yes</td></tr>
                  <tr><th>Goes first</th><td>Readers</td><td>Waiting writers</td><td>Oldest request</td></tr>
                  <tr><th>Writers can starve</th><td>Yes</td><td>No, under its assumptions</td><td>No, under its assumptions</td></tr>
                  <tr><th>Readers can starve</th><td>Rarely</td><td>Yes</td><td>No, under its assumptions</td></tr>
                  <tr><th>Complexity</th><td>Low</td><td>Medium</td><td>Higher</td></tr>
                </tbody>
              </table>
            </div>
            <div className="prose" style={{ paddingTop: 20 }}><p className="muted">“No” depends on every thread eventually making progress and on cancellation being handled. It is a property of the design under stated assumptions, not a guarantee of every execution.</p></div>
          </section>
        </div>
      </div>
    </div>
  );
}

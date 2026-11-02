import { Lanes } from '../components/Lanes';
import { EventLog } from '../components/EventLog';
import { Controls, StatusSticker } from '../components/Controls';
import { ConnChip, Letters, OfflineCard, PageHead } from '../components/Shell';
import { useSync } from '../store';

export function Trace() {
  const { events, sim } = useSync();
  return (
    <div className="page">
      <PageHead
        title={<Letters text="Trace every move." />}
        sub="Each row is one thread. The shaded columns are the moments a writer held the register alone. Nothing else may be inside them."
      >
        <div className="head-meta">
          <ConnChip />
          <StatusSticker />
        </div>
        <Controls />
      </PageHead>
      <OfflineCard />
      <section className="panel" aria-labelledby="lanes-h">
        <div className="panel-head">
          <h2 id="lanes-h">Swim lanes</h2>
          <span className="mono">{events.length} events · {sim?.processes.length ?? 0} threads</span>
        </div>
        <Lanes />
      </section>
      <EventLog />
    </div>
  );
}

import { ConfigPanel } from '../components/ConfigPanel';
import { Controls, StatusSticker } from '../components/Controls';
import { InvariantsPanel, MetricsPanel, StatStrip } from '../components/Panels';
import { ProcessFloor } from '../components/ProcessFloor';
import { ResourceCore } from '../components/ResourceCore';
import { SemaphoreBoard } from '../components/SemaphoreBoard';
import { ConnChip, Letters, OfflineCard, PageHead } from '../components/Shell';

export function Lab() {
  return (
    <div className="page">
      <PageHead
        title={<Letters text="Readers share. Writers don't." />}
        sub="Real threads, real semaphores. Launch a run and watch who gets the shared register, and who is left waiting."
      >
        <div className="head-meta">
          <ConnChip />
          <StatusSticker />
        </div>
        <Controls />
      </PageHead>
      <OfflineCard />
      <StatStrip />
      <div className="lab">
        <aside className="lab-side"><ConfigPanel /></aside>
        <div className="lab-main">
          <ResourceCore />
          <div className="twin">
            <SemaphoreBoard />
            <InvariantsPanel compact />
          </div>
          <ProcessFloor />
          <MetricsPanel />
        </div>
      </div>
    </div>
  );
}

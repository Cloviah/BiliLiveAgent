import type { AppCtx } from '../App';
import AccountPanel from '../components/panels/AccountPanel';
import ModelPanel from '../components/panels/ModelPanel';
import InteractionPanel from '../components/panels/InteractionPanel';
import PluginPanel from '../components/panels/PluginPanel';
import LifecyclePanel, { RetentionCard } from '../components/panels/LifecyclePanel';
import DataPanel from '../components/panels/DataPanel';
import DiagPanel from '../components/panels/DiagPanel';

export default function SettingsPage({ ctx }: { ctx: AppCtx }) {
  return (
    <div className="space-y-4">
      <AccountPanel ctx={ctx} />
      <ModelPanel ctx={ctx} />
      <div className="grid grid-cols-2 gap-4">
        <LifecyclePanel ctx={ctx} />
        <RetentionCard ctx={ctx} />
      </div>
      <InteractionPanel ctx={ctx} />
      <PluginPanel ctx={ctx} />
      <DataPanel ctx={ctx} />
      <DiagPanel ctx={ctx} />
    </div>
  );
}

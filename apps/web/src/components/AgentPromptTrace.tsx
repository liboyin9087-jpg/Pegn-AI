import type { AgentRunDetail } from '../api/client';

export default function AgentPromptTrace({ run }: { run: AgentRunDetail }) {
  return (
    <div className="rounded-xl border border-border bg-panel p-3">
      <p className="text-xs font-medium text-text-secondary">Prompt Trace</p>
      <dl className="mt-2 grid grid-cols-2 gap-2 text-xs text-text-tertiary">
        <div>
          <dt>Prompt version</dt>
          <dd className="mt-1 text-text-primary">{run.promptVersion ?? 'v1'}</dd>
        </div>
        <div>
          <dt>Prompt label</dt>
          <dd className="mt-1 text-text-primary">{run.promptLabel ?? 'supervisor'}</dd>
        </div>
        <div>
          <dt>Template ID</dt>
          <dd className="mt-1 text-text-primary">{run.templateId ?? '-'}</dd>
        </div>
        <div>
          <dt>Template version</dt>
          <dd className="mt-1 text-text-primary">{run.templateVersion ?? 'v1'}</dd>
        </div>
      </dl>
    </div>
  );
}

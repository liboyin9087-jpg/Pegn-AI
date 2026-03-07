import type { AgentRunDetail } from '../api/client';
import AgentArtifactsList from './AgentArtifactsList';
import AgentFailureState from './AgentFailureState';
import AgentPromptTrace from './AgentPromptTrace';

export default function AgentRunDetailPanel({
  run,
  canRerun,
  onRerun,
  onOpenJob,
  onOpenJobTrace,
}: {
  run: AgentRunDetail;
  canRerun: boolean;
  onRerun?: () => void;
  onOpenJob?: (jobId: string) => void;
  onOpenJobTrace?: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-border bg-panel p-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-xs font-mono text-text-tertiary">#{run.runId.slice(0, 8)}</p>
            <p className="mt-1 text-sm font-medium text-text-primary">{run.title ?? 'Agent run'}</p>
            {run.rerunOfRunId ? (
              <p className="mt-1 text-xs text-text-tertiary">Rerun of {run.rerunOfRunId}</p>
            ) : null}
          </div>
          <div className="text-right text-xs text-text-tertiary">
            <p>{new Date(run.createdAt).toLocaleString()}</p>
            {run.finishedAt ? <p className="mt-1">Finished: {new Date(run.finishedAt).toLocaleTimeString()}</p> : null}
          </div>
        </div>

        <div className="mt-3 space-y-2 text-xs">
          <div className="rounded-lg bg-surface px-3 py-2">
            <p className="font-medium text-text-secondary">Input</p>
            <p className="mt-1 whitespace-pre-wrap text-text-primary">{run.input}</p>
          </div>
          <div className="rounded-lg bg-surface px-3 py-2">
            <p className="font-medium text-text-secondary">Output</p>
            <p className="mt-1 whitespace-pre-wrap text-text-primary">{run.output ?? run.outputSummary ?? 'No output available yet'}</p>
          </div>
        </div>
      </div>

      {run.status === 'failed' && run.errorSummary ? (
        <AgentFailureState
          errorSummary={run.errorSummary}
          jobId={run.jobId}
          canRerun={canRerun}
          onRerun={onRerun}
          onOpenJob={onOpenJob}
          onOpenJobTrace={onOpenJobTrace}
          readOnlyReason={canRerun ? undefined : 'You can inspect this run, but you do not have permission to rerun it.'}
        />
      ) : null}

      <AgentPromptTrace run={run} />

      <div className="rounded-xl border border-border bg-panel p-3">
        <p className="text-xs font-medium text-text-secondary">Citations</p>
        <div className="mt-2 space-y-2">
          {run.citations.length === 0 ? (
            <p className="text-xs text-text-tertiary">No citations recorded for this run.</p>
          ) : run.citations.map((citation) => (
            <div key={citation.id} className="rounded-lg border border-border bg-surface px-3 py-2 text-xs">
              <div className="flex items-center justify-between gap-2">
                <p className="font-medium text-text-primary">{citation.title}</p>
                <span className="text-text-tertiary">{citation.sourceType}</span>
              </div>
              <p className="mt-1 text-text-secondary">{citation.snippet}</p>
            </div>
          ))}
        </div>
      </div>

      <AgentArtifactsList items={run.relatedArtifacts} />
    </div>
  );
}

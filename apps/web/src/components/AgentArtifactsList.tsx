import type { AgentRunArtifact } from '../api/client';

export default function AgentArtifactsList({ items }: { items: AgentRunArtifact[] }) {
  if (items.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-panel p-3 text-xs text-text-tertiary">
        No artifacts recorded for this run.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-panel p-3">
      <p className="text-xs font-medium text-text-secondary">Artifacts</p>
      <div className="mt-2 space-y-2">
        {items.map((artifact) => (
          <div key={artifact.artifactId} className="rounded-lg border border-border bg-surface px-3 py-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <p className="font-medium text-text-primary">{artifact.title}</p>
              <span className="text-text-tertiary">{artifact.type}</span>
            </div>
            <p className="mt-1 text-text-tertiary">
              {artifact.mimeType ?? 'application/octet-stream'}
              {artifact.size != null ? ` · ${artifact.size} bytes` : ''}
            </p>
            <p className="mt-1 text-text-tertiary">{new Date(artifact.createdAt).toLocaleString()}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

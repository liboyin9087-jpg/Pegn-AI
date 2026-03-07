import React from 'react';
import type { JobRecord, WorkspacePermissionSummary } from '../api/client';
import EmptyState from './EmptyState';
import ErrorState from './ErrorState';
import LoadingSkeleton from './LoadingSkeleton';
import JobStatusBadge from './JobStatusBadge';

function canMutateJob(job: JobRecord, permissions: WorkspacePermissionSummary) {
  if (job.jobType === 'document_index' || job.jobType === 'document_reindex') {
    return permissions.canEditDocuments;
  }
  return permissions.canRunAutomation;
}

export default function JobsTable({
  jobs,
  loading,
  error,
  selectedJobId,
  permissions,
  onSelectJob,
  onRetry,
  onCancel,
}: {
  jobs: JobRecord[];
  loading: boolean;
  error: string | null;
  selectedJobId?: string | null;
  permissions: WorkspacePermissionSummary;
  onSelectJob: (jobId: string) => void;
  onRetry: (jobId: string) => void;
  onCancel: (jobId: string) => void;
}) {
  if (loading) {
    return <LoadingSkeleton lines={4} />;
  }

  if (error) {
    return <ErrorState title="Failed to load jobs" description={error} />;
  }

  if (jobs.length === 0) {
    return (
      <EmptyState
        title="No jobs found"
        description="Run an index, agent, or automation task to start building an operations trail."
      />
    );
  }

  return (
    <div className="space-y-2">
      {jobs.map((job) => {
        const canMutate = canMutateJob(job, permissions);
        const canRetry = canMutate && (job.status === 'failed' || job.status === 'timeout');
        const canCancel = canMutate && (job.status === 'queued' || job.status === 'running');
        const selected = selectedJobId === job.id;

        return (
          <button
            key={job.id}
            onClick={() => onSelectJob(job.id)}
            className={`w-full rounded-xl border p-3 text-left transition-colors ${selected ? 'border-accent bg-accent-light/40' : 'border-border bg-panel hover:bg-surface-secondary'}`}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium uppercase text-text-secondary">{job.jobType}</span>
                  <JobStatusBadge status={job.status} cancelRequestedAt={job.cancelRequestedAt} />
                </div>
                <p className="mt-1 text-xs text-text-tertiary">
                  {job.resourceType && job.resourceId ? `${job.resourceType}:${job.resourceId}` : job.sourceDomain}
                </p>
                {job.errorSummary ? (
                  <p className="mt-1 line-clamp-2 text-xs text-error">{job.errorSummary}</p>
                ) : null}
              </div>
              <div className="text-right text-[11px] text-text-tertiary">
                <p>{new Date(job.createdAt).toLocaleString()}</p>
                {job.triggeredVia ? <p className="mt-1 capitalize">{job.triggeredVia}</p> : null}
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2">
              <span className="text-[11px] text-text-tertiary">#{job.id.slice(0, 8)}</span>
              <div className="flex-1" />
              {canRetry ? (
                <span
                  onClick={(event) => {
                    event.stopPropagation();
                    onRetry(job.id);
                  }}
                  className="rounded-lg border border-accent px-2 py-1 text-[11px] text-accent"
                >
                  Retry
                </span>
              ) : null}
              {canCancel ? (
                <span
                  onClick={(event) => {
                    event.stopPropagation();
                    onCancel(job.id);
                  }}
                  className="rounded-lg border border-border px-2 py-1 text-[11px] text-text-secondary"
                >
                  Cancel
                </span>
              ) : null}
            </div>
          </button>
        );
      })}
    </div>
  );
}

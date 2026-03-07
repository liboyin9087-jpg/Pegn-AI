import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  cancelWorkspaceJob,
  getWorkspaceJob,
  getWorkspaceJobEvents,
  getWorkspaceJobSummary,
  listWorkspaceJobs,
  retryWorkspaceJob,
  trackProductEvent,
  type JobRecord,
  type JobStatus,
  type JobType,
  type SurfaceLinkTarget,
} from '../api/client';
import { useOptionalAppContext, useRefreshVersion, useWorkspacePermissions } from '../contexts/AppContext';
import EmptyState from './EmptyState';
import ErrorState from './ErrorState';
import InlineRetryState from './InlineRetryState';
import JobsTable from './JobsTable';
import JobStatusBadge from './JobStatusBadge';
import JobTimeline from './JobTimeline';
import LoadingSkeleton from './LoadingSkeleton';
import ThreadPanel from './ThreadPanel';

const STATUS_FILTERS: Array<{ id: 'all' | JobStatus; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'failed', label: 'Failed' },
  { id: 'running', label: 'Running' },
  { id: 'queued', label: 'Queued' },
  { id: 'succeeded', label: 'Succeeded' },
];

const TYPE_FILTERS: Array<{ id: 'all' | JobType; label: string }> = [
  { id: 'all', label: 'All types' },
  { id: 'document_index', label: 'Index' },
  { id: 'document_reindex', label: 'Reindex' },
  { id: 'agent_run', label: 'Agent' },
  { id: 'automation_trigger', label: 'Automation' },
];

export default function OperationsPanel({
  workspaceId,
  selectedJobId,
  initialJobType = 'all',
  navigationTarget,
  onOpenSurfaceTarget,
}: {
  workspaceId: string;
  selectedJobId?: string | null;
  initialJobType?: 'all' | JobType;
  navigationTarget?: SurfaceLinkTarget | null;
  onOpenSurfaceTarget?: (target: SurfaceLinkTarget) => void;
}) {
  const permissions = useWorkspacePermissions();
  const appContext = useOptionalAppContext();
  const savedContext = appContext?.surfaceContexts?.operations;
  const refreshVersion = useRefreshVersion('jobs');
  const [statusFilter, setStatusFilter] = useState<'all' | JobStatus>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | JobType>(initialJobType);
  const [jobs, setJobs] = useState<JobRecord[]>([]);
  const [jobsLoading, setJobsLoading] = useState(true);
  const [jobsError, setJobsError] = useState<string | null>(null);
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof getWorkspaceJobSummary>> | null>(null);
  const [selectedJob, setSelectedJob] = useState<JobRecord | null>(null);
  const [events, setEvents] = useState<Awaited<ReturnType<typeof getWorkspaceJobEvents>>['items']>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [threadOpen, setThreadOpen] = useState(false);

  const loadJobs = useCallback(async () => {
    setJobsLoading(true);
    setJobsError(null);
    try {
      const [summaryResponse, jobsResponse] = await Promise.all([
        getWorkspaceJobSummary(workspaceId),
        listWorkspaceJobs(workspaceId, {
          ...(statusFilter !== 'all' ? { status: statusFilter } : {}),
          ...(typeFilter !== 'all' ? { jobType: typeFilter } : {}),
          limit: 25,
        }),
      ]);
      setSummary(summaryResponse);
      setJobs(jobsResponse.items);
    } catch (error) {
      setJobsError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setJobsLoading(false);
    }
  }, [statusFilter, typeFilter, workspaceId]);

  const loadJobDetail = useCallback(async (jobId: string) => {
    setDetailLoading(true);
    setDetailError(null);
    try {
      const [job, eventResponse] = await Promise.all([
        getWorkspaceJob(workspaceId, jobId),
        getWorkspaceJobEvents(workspaceId, jobId),
      ]);
      setSelectedJob(job);
      setEvents(eventResponse.items);
    } catch (error) {
      setDetailError(error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setDetailLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    setTypeFilter(initialJobType);
  }, [initialJobType]);

  useEffect(() => {
    void loadJobs();
  }, [loadJobs, refreshVersion]);

  useEffect(() => {
    if (selectedJobId) {
      void loadJobDetail(selectedJobId);
    }
  }, [loadJobDetail, selectedJobId]);

  useEffect(() => {
    if (!navigationTarget || navigationTarget.surface !== 'operations') return;
    if (navigationTarget.payload.jobType) {
      setTypeFilter(navigationTarget.payload.jobType);
    }
    if (navigationTarget.payload.jobId) {
      void loadJobDetail(navigationTarget.payload.jobId);
    }
  }, [loadJobDetail, navigationTarget]);

  useEffect(() => {
    if (!savedContext) return;
    setStatusFilter((savedContext.status as 'all' | JobStatus | null) ?? 'all');
    setTypeFilter((savedContext.jobType as 'all' | JobType | null) ?? 'all');
    if (savedContext.selectedJobId && savedContext.detailOpen) {
      void loadJobDetail(savedContext.selectedJobId);
    } else if (!savedContext.detailOpen) {
      setSelectedJob(null);
      setEvents([]);
    }
  }, [loadJobDetail, savedContext]);

  useEffect(() => {
    setThreadOpen(false);
  }, [selectedJob?.id]);

  useEffect(() => {
    appContext?.setSurfaceContext?.('operations', {
      status: statusFilter === 'all' ? null : statusFilter,
      jobType: typeFilter === 'all' ? null : typeFilter,
      resourceType: null,
      selectedJobId: selectedJob?.id ?? null,
      detailOpen: Boolean(selectedJob),
      showFailedOnly: statusFilter === 'failed',
    });
  }, [appContext, selectedJob, statusFilter, typeFilter]);

  const activeFailedJobs = useMemo(
    () => jobs.filter((job) => job.status === 'failed' || job.status === 'timeout'),
    [jobs]
  );

  const handleRetry = useCallback(async (jobId: string) => {
    if (appContext?.user?.id) {
      void trackProductEvent('job_retry_clicked', {
        workspaceId,
        userId: appContext.user.id,
        surface: 'operations',
        targetType: 'job',
        targetId: jobId,
      }).catch(() => undefined);
    }
    await retryWorkspaceJob(workspaceId, jobId);
    appContext?.requestRefresh(['jobs', 'admin', 'audit', 'inbox']);
    await loadJobs();
  }, [appContext?.user?.id, loadJobs, workspaceId]);

  const handleCancel = useCallback(async (jobId: string) => {
    await cancelWorkspaceJob(workspaceId, jobId);
    appContext?.requestRefresh(['jobs', 'admin', 'audit', 'inbox']);
    await loadJobs();
    if (selectedJob?.id === jobId) {
      await loadJobDetail(jobId);
    }
  }, [appContext, loadJobDetail, loadJobs, selectedJob?.id, workspaceId]);

  return (
    <div className="flex h-full flex-col gap-3 bg-surface p-3">
      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-xl border border-border bg-panel p-3">
          <p className="text-xs font-medium text-text-secondary">Running</p>
          <p className="mt-1 text-lg font-semibold text-text-primary">{summary?.running ?? 0}</p>
        </div>
        <div className="rounded-xl border border-border bg-panel p-3">
          <p className="text-xs font-medium text-text-secondary">Failed / Timeout</p>
          <p className="mt-1 text-lg font-semibold text-error">{(summary?.failed ?? 0) + (summary?.timeout ?? 0)}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        {STATUS_FILTERS.map((filter) => (
          <button
            key={filter.id}
            onClick={() => setStatusFilter(filter.id)}
            className={`rounded-lg px-2 py-1 text-xs ${statusFilter === filter.id ? 'bg-accent text-white' : 'bg-surface-secondary text-text-secondary'}`}
          >
            {filter.label}
          </button>
        ))}
        <div className="flex-1" />
        <select
          value={typeFilter}
          onChange={(event) => setTypeFilter(event.target.value as 'all' | JobType)}
          className="rounded-lg border border-border bg-surface px-2 py-1 text-xs text-text-primary"
        >
          {TYPE_FILTERS.map((filter) => (
            <option key={filter.id} value={filter.id}>{filter.label}</option>
          ))}
        </select>
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
        <JobsTable
          jobs={jobs}
          loading={jobsLoading}
          error={jobsError}
          selectedJobId={selectedJob?.id ?? selectedJobId ?? null}
          permissions={permissions}
          onSelectJob={(jobId) => { void loadJobDetail(jobId); }}
          onRetry={(jobId) => { void handleRetry(jobId); }}
          onCancel={(jobId) => { void handleCancel(jobId); }}
        />

        {activeFailedJobs.length > 0 && !jobsLoading ? (
          <div className="rounded-xl border border-error/20 bg-error/5 p-3">
            <p className="text-xs font-medium text-error">Recent failed jobs</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {activeFailedJobs.slice(0, 5).map((job) => (
                <button
                  key={job.id}
                  onClick={() => { void loadJobDetail(job.id); }}
                  className="rounded-lg border border-error/20 px-2 py-1 text-xs text-error"
                >
                  {job.jobType} #{job.id.slice(0, 6)}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {detailLoading ? <LoadingSkeleton lines={3} /> : null}
        {detailError ? (
          <InlineRetryState
            title="Failed to load job detail"
            description={detailError}
            onRetry={selectedJobId ? () => { void loadJobDetail(selectedJobId); } : undefined}
          />
        ) : null}
        {!detailLoading && !detailError && selectedJob ? (
          <div className="space-y-3">
            <div className="rounded-xl border border-border bg-panel p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase text-text-secondary">{selectedJob.jobType}</p>
                  <div className="mt-1">
                    <JobStatusBadge status={selectedJob.status} cancelRequestedAt={selectedJob.cancelRequestedAt} />
                  </div>
                  <p className="mt-2 text-xs text-text-tertiary">
                    {selectedJob.resourceType && selectedJob.resourceId
                      ? `${selectedJob.resourceType}:${selectedJob.resourceId}`
                      : selectedJob.sourceDomain}
                  </p>
                </div>
                <div className="text-right text-[11px] text-text-tertiary">
                  <p>#{selectedJob.id.slice(0, 8)}</p>
                  <p>{new Date(selectedJob.createdAt).toLocaleString()}</p>
                </div>
              </div>
              {selectedJob.errorSummary ? (
                <p className="mt-3 text-xs text-error">{selectedJob.errorSummary}</p>
              ) : null}

              <div className="mt-3">
                <button
                  type="button"
                  onClick={() => setThreadOpen((current) => !current)}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-tertiary"
                >
                  {threadOpen ? 'Hide discussion' : 'Discuss job'}
                </button>
              </div>
            </div>
            <JobTimeline events={events} />
            {threadOpen ? (
              <ThreadPanel
                workspaceId={workspaceId}
                targetType="job"
                targetId={selectedJob.id}
                title={selectedJob.jobType}
                onOpenSurfaceTarget={onOpenSurfaceTarget}
              />
            ) : null}
          </div>
        ) : null}

        {!detailLoading && !detailError && !selectedJob && !jobsLoading ? (
          <EmptyState
            title="Select a job to inspect"
            description="Choose any job above to view its detail and event timeline."
          />
        ) : null}
      </div>
    </div>
  );
}

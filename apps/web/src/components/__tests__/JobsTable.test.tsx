import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import JobsTable from '../JobsTable';
import type { JobRecord, WorkspacePermissionSummary } from '../../api/client';

const editorPermissions: WorkspacePermissionSummary = {
  canViewWorkspace: true,
  canManageMembers: false,
  canManageSettings: false,
  canEditDocuments: true,
  canDeleteDocuments: true,
  canRunAutomation: true,
  canCollaborate: true,
  canManageAssignments: true,
};

function makeJob(overrides: Partial<JobRecord> = {}): JobRecord {
  return {
    id: 'job-1',
    workspaceId: 'ws-1',
    jobType: 'agent_run',
    resourceType: 'agent_run',
    resourceId: 'run-1',
    sourceDomain: 'agent',
    sourceRunId: 'run-1',
    triggeredBy: 'user-1',
    triggeredVia: 'manual',
    status: 'failed',
    errorCode: 'runtime_error',
    errorSummary: 'Model timeout',
    createdAt: '2026-03-07T10:00:00.000Z',
    updatedAt: '2026-03-07T10:00:10.000Z',
    startedAt: '2026-03-07T10:00:01.000Z',
    finishedAt: '2026-03-07T10:00:10.000Z',
    retryOfJobId: null,
    cancelRequestedAt: null,
    metadata: {},
    ...overrides,
  };
}

describe('JobsTable', () => {
  it('renders job type, status, and retry CTA for failed jobs', () => {
    const onRetry = vi.fn();
    render(
      <JobsTable
        jobs={[makeJob()]}
        loading={false}
        error={null}
        permissions={editorPermissions}
        onSelectJob={vi.fn()}
        onRetry={onRetry}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText('agent_run')).toBeInTheDocument();
    expect(screen.getByText('失敗')).toBeInTheDocument();
    expect(screen.getByText('Model timeout')).toBeInTheDocument();
    fireEvent.click(screen.getByText('Retry'));
    expect(onRetry).toHaveBeenCalledWith('job-1');
  });

  it('renders cancel CTA for running jobs with permission', () => {
    const onCancel = vi.fn();
    render(
      <JobsTable
        jobs={[makeJob({ status: 'running', errorSummary: null, errorCode: null, finishedAt: null })]}
        loading={false}
        error={null}
        permissions={editorPermissions}
        onSelectJob={vi.fn()}
        onRetry={vi.fn()}
        onCancel={onCancel}
      />
    );

    fireEvent.click(screen.getByText('Cancel'));
    expect(onCancel).toHaveBeenCalledWith('job-1');
  });

  it('shows empty state when no jobs exist', () => {
    render(
      <JobsTable
        jobs={[]}
        loading={false}
        error={null}
        permissions={editorPermissions}
        onSelectJob={vi.fn()}
        onRetry={vi.fn()}
        onCancel={vi.fn()}
      />
    );

    expect(screen.getByText('No jobs found')).toBeInTheDocument();
  });
});

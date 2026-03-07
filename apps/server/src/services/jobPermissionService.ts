import type { WorkspacePermissionSummary } from '../lib/workspaceRoles.js';
import type { JobRecord } from './jobService.js';

type JobCapability = keyof WorkspacePermissionSummary;

export function getJobRequiredCapabilityForRead(): JobCapability {
  return 'canViewWorkspace';
}

export function getJobRequiredCapabilityForRetry(job: Pick<JobRecord, 'jobType'>): JobCapability {
  switch (job.jobType) {
    case 'document_index':
    case 'document_reindex':
      return 'canEditDocuments';
    case 'agent_run':
    case 'automation_trigger':
      return 'canRunAutomation';
    default:
      return 'canViewWorkspace';
  }
}

export function getJobRequiredCapabilityForCancel(job: Pick<JobRecord, 'jobType'>): JobCapability {
  return getJobRequiredCapabilityForRetry(job);
}

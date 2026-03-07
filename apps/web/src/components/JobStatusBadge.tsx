import React from 'react';
import type { JobRecord, JobStatus } from '../api/client';

const STATUS_LABELS: Record<JobStatus, string> = {
  queued: '等待中',
  running: '執行中',
  succeeded: '已完成',
  failed: '失敗',
  cancelled: '已取消',
  timeout: '執行逾時',
};

const STATUS_STYLES: Record<JobStatus, string> = {
  queued: 'bg-surface-secondary text-text-tertiary',
  running: 'bg-warning/10 text-warning',
  succeeded: 'bg-success/10 text-success',
  failed: 'bg-error/10 text-error',
  cancelled: 'bg-surface-secondary text-text-secondary',
  timeout: 'bg-error/10 text-error',
};

export default function JobStatusBadge({
  status,
  cancelRequestedAt,
}: {
  status: JobStatus;
  cancelRequestedAt?: JobRecord['cancelRequestedAt'];
}) {
  const isCancelling = status === 'running' && Boolean(cancelRequestedAt);
  const label = isCancelling ? '取消中' : STATUS_LABELS[status];

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[status]}`}>
      {label}
    </span>
  );
}

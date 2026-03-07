import type { WorkflowActionStatus } from '../api/client';

const STATUS_LABEL: Record<WorkflowActionStatus, string> = {
  draft: 'Draft',
  pending_approval: 'Pending approval',
  approved: 'Approved',
  executing: 'Executing',
  executed: 'Executed',
  rejected: 'Rejected',
  execution_failed: 'Execution failed',
  cancelled: 'Cancelled',
};

export default function WorkflowActionStatusBadge({ status }: { status: WorkflowActionStatus }) {
  const isFailure = status === 'rejected' || status === 'execution_failed' || status === 'cancelled';
  const isSuccess = status === 'executed';
  const className = isFailure
    ? 'bg-error/10 text-error'
    : isSuccess
      ? 'bg-success/10 text-success'
      : 'bg-accent/10 text-accent';

  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-[11px] font-medium ${className}`}>
      {STATUS_LABEL[status]}
    </span>
  );
}

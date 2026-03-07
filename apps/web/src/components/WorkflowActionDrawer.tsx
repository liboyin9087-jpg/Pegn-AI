import type { SurfaceLinkTarget, WorkflowActionDetail } from '../api/client';
import WorkflowActionStatusBadge from './WorkflowActionStatusBadge';
import WorkflowApprovalPanel from './WorkflowApprovalPanel';

export default function WorkflowActionDrawer({
  action,
  open,
  loading,
  canApprove,
  canReject,
  canCancel,
  onClose,
  onApprove,
  onReject,
  onCancel,
  onOpenSurfaceTarget,
}: {
  action: WorkflowActionDetail | null;
  open: boolean;
  loading?: boolean;
  canApprove: boolean;
  canReject: boolean;
  canCancel: boolean;
  onClose: () => void;
  onApprove?: () => Promise<void> | void;
  onReject?: (comment?: string) => Promise<void> | void;
  onCancel?: () => Promise<void> | void;
  onOpenSurfaceTarget?: (target: SurfaceLinkTarget) => void;
}) {
  if (!open || !action) return null;

  return (
    <div className="rounded-2xl border border-border bg-surface-secondary p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-mono text-text-tertiary">#{action.actionId.slice(0, 8)}</p>
          <p className="mt-1 text-sm font-semibold text-text-primary">{action.summary}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-surface"
        >
          Close
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <WorkflowActionStatusBadge status={action.status} />
        <span className="text-xs text-text-tertiary">{action.actionType}</span>
        <span className="text-xs text-text-tertiary">{new Date(action.createdAt).toLocaleString()}</span>
      </div>

      {action.executionErrorSummary ? (
        <div className="mt-3 rounded-lg border border-error/20 bg-error/5 px-3 py-2 text-xs text-error">
          {action.executionErrorSummary}
        </div>
      ) : null}

      <div className="mt-3 space-y-2 rounded-xl border border-border bg-panel p-3">
        <p className="text-xs font-medium text-text-secondary">Details</p>
        <div className="space-y-1 text-xs text-text-secondary">
          <p>Target: {action.targetType}:{action.targetId}</p>
          <p>Requested by: {action.requestedBy.displayName}</p>
          <p>Approval mode: {action.approvalMode}</p>
          {action.executedJobId ? <p>Job: {action.executedJobId}</p> : null}
          {action.executedRunId ? <p>Run: {action.executedRunId}</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onOpenSurfaceTarget?.(action.sourceTarget)}
            className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-surface"
          >
            Open source
          </button>
          {canCancel && ['draft', 'pending_approval'].includes(action.status) ? (
            <button
              type="button"
              disabled={loading}
              onClick={() => void onCancel?.()}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-surface disabled:opacity-50"
            >
              Cancel action
            </button>
          ) : null}
        </div>
      </div>

      {action.approvalHistory.length > 0 ? (
        <div className="mt-3 rounded-xl border border-border bg-panel p-3">
          <p className="text-xs font-medium text-text-secondary">Approval history</p>
          <div className="mt-2 space-y-2">
            {action.approvalHistory.map((item) => (
              <div key={item.approvalId} className="text-xs text-text-secondary">
                <span className="font-medium text-text-primary">{item.decision}</span>
                {' by '}
                <span>{item.approverUserId}</span>
                {' • '}
                <span>{new Date(item.createdAt).toLocaleString()}</span>
                {item.comment ? <p className="mt-1 text-text-tertiary">{item.comment}</p> : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="mt-3">
        <WorkflowApprovalPanel
          canApprove={canApprove && action.status === 'pending_approval'}
          canReject={canReject && action.status === 'pending_approval'}
          loading={loading}
          onApprove={onApprove}
          onReject={onReject}
        />
      </div>
    </div>
  );
}

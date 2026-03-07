import React, { useMemo, useState } from 'react';
import type { ThreadAssignment, WorkspaceMemberRecord } from '../api/client';

export default function ThreadAssignmentBar({
  currentAssignment,
  members,
  canManageAssignments,
  onAssign,
}: {
  currentAssignment: ThreadAssignment | null;
  members: WorkspaceMemberRecord[];
  canManageAssignments: boolean;
  onAssign: (payload: { assignedToUserId: string; dueAt?: string | null }) => Promise<void> | void;
}) {
  const [assignedToUserId, setAssignedToUserId] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const currentAssignee = useMemo(
    () => members.find((member) => member.user_id === currentAssignment?.assignedToUserId) ?? null,
    [currentAssignment?.assignedToUserId, members]
  );

  return (
    <div className="rounded-xl border border-border bg-panel px-3 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-text-secondary">Assignment</p>
          {currentAssignment ? (
            <div className="mt-1 space-y-1 text-xs text-text-primary">
              <p>
                Assigned to {currentAssignee?.name?.trim() || currentAssignee?.email || currentAssignment.assignedToUserId}
              </p>
              <p className="text-text-tertiary">
                Status {currentAssignment.status}
                {currentAssignment.dueAt ? ` • Due ${new Date(currentAssignment.dueAt).toLocaleDateString()}` : ''}
              </p>
            </div>
          ) : (
            <p className="mt-1 text-xs text-text-tertiary">No current assignee.</p>
          )}
        </div>

        {canManageAssignments ? (
          <div className="flex flex-wrap items-center gap-2">
            <select
              value={assignedToUserId}
              onChange={(event) => setAssignedToUserId(event.target.value)}
              className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-text-primary"
            >
              <option value="">Assign teammate</option>
              {members.map((member) => (
                <option key={member.user_id} value={member.user_id}>
                  {member.name?.trim() || member.email}
                </option>
              ))}
            </select>
            <input
              type="date"
              value={dueAt}
              onChange={(event) => setDueAt(event.target.value)}
              className="rounded-lg border border-border bg-surface px-2 py-1.5 text-xs text-text-primary"
            />
            <button
              type="button"
              disabled={!assignedToUserId || submitting}
              onClick={async () => {
                if (!assignedToUserId) return;
                setSubmitting(true);
                try {
                  await onAssign({
                    assignedToUserId,
                    dueAt: dueAt ? new Date(`${dueAt}T00:00:00`).toISOString() : null,
                  });
                  setAssignedToUserId('');
                  setDueAt('');
                } finally {
                  setSubmitting(false);
                }
              }}
              className="rounded-lg border border-accent px-3 py-1.5 text-xs text-accent hover:bg-accent-light disabled:opacity-50"
            >
              {currentAssignment ? 'Reassign' : 'Assign'}
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

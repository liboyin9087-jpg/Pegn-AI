import React from 'react';
import type { WorkspaceMemberRecord } from '../api/client';

export default function MentionPicker({
  members,
  selectedUserIds,
  disabled = false,
  onChange,
}: {
  members: WorkspaceMemberRecord[];
  selectedUserIds: string[];
  disabled?: boolean;
  onChange: (userIds: string[]) => void;
}) {
  if (members.length === 0) return null;

  return (
    <div className="space-y-2">
      <p className="text-[11px] font-medium text-text-secondary">Mention teammates</p>
      <div className="max-h-28 space-y-1 overflow-y-auto rounded-lg border border-border bg-surface px-2 py-2">
        {members.map((member) => {
          const checked = selectedUserIds.includes(member.user_id);
          return (
            <label
              key={member.user_id}
              className="flex items-center gap-2 text-xs text-text-secondary"
            >
              <input
                type="checkbox"
                checked={checked}
                disabled={disabled}
                onChange={(event) => {
                  if (event.target.checked) {
                    onChange([...selectedUserIds, member.user_id]);
                    return;
                  }
                  onChange(selectedUserIds.filter((id) => id !== member.user_id));
                }}
              />
              <span className="truncate">
                {member.name?.trim() || member.email}
              </span>
            </label>
          );
        })}
      </div>
    </div>
  );
}

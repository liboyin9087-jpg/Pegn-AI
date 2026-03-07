import React, { useState } from 'react';
import type { WorkspaceMemberRecord } from '../api/client';
import MentionPicker from './MentionPicker';

export default function ThreadComposer({
  canCollaborate,
  members,
  onSubmit,
}: {
  canCollaborate: boolean;
  members: WorkspaceMemberRecord[];
  onSubmit: (payload: { body: string; mentionedUserIds: string[] }) => Promise<void> | void;
}) {
  const [body, setBody] = useState('');
  const [mentionedUserIds, setMentionedUserIds] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);

  if (!canCollaborate) {
    return (
      <div className="rounded-xl border border-border bg-panel px-3 py-3 text-xs text-text-tertiary">
        You can read this thread, but only editors and admins can comment or mention teammates.
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-border bg-panel px-3 py-3">
      <p className="text-xs font-medium text-text-secondary">Add comment</p>
      <textarea
        value={body}
        onChange={(event) => setBody(event.target.value)}
        rows={4}
        placeholder="Add context, decisions, or next steps..."
        className="mt-2 w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none"
      />
      <div className="mt-3">
        <MentionPicker
          members={members}
          selectedUserIds={mentionedUserIds}
          onChange={setMentionedUserIds}
          disabled={submitting}
        />
      </div>
      <div className="mt-3 flex justify-end">
        <button
          type="button"
          disabled={!body.trim() || submitting}
          onClick={async () => {
            if (!body.trim()) return;
            setSubmitting(true);
            try {
              await onSubmit({
                body: body.trim(),
                mentionedUserIds,
              });
              setBody('');
              setMentionedUserIds([]);
            } finally {
              setSubmitting(false);
            }
          }}
          className="rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white hover:bg-accent-hover disabled:opacity-50"
        >
          {submitting ? 'Posting...' : 'Post comment'}
        </button>
      </div>
    </div>
  );
}

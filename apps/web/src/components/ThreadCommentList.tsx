import React from 'react';
import type { ThreadComment } from '../api/client';
import EmptyState from './EmptyState';

export default function ThreadCommentList({
  comments,
}: {
  comments: ThreadComment[];
}) {
  if (comments.length === 0) {
    return (
      <EmptyState
        title="No comments yet"
        description="Start the discussion when you need to capture context or assign follow-up work."
      />
    );
  }

  return (
    <div className="space-y-2">
      {comments.map((comment) => (
        <div key={comment.commentId} className="rounded-xl border border-border bg-panel px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs font-medium text-text-primary">
              {comment.author.name?.trim() || comment.author.email || comment.author.userId}
            </p>
            <span className="text-[11px] text-text-tertiary">
              {new Date(comment.createdAt).toLocaleString()}
            </span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-xs leading-6 text-text-secondary">{comment.body}</p>
          {comment.mentionedUserIds.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {comment.mentionedUserIds.map((userId) => (
                <span
                  key={userId}
                  className="rounded-full bg-accent-light px-2 py-0.5 text-[11px] font-medium text-accent"
                >
                  @{userId.slice(0, 8)}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </div>
  );
}

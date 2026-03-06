import React from 'react';

export default function ForbiddenState({
  title = 'Read-only access',
  description = 'You can view this workspace, but you do not have permission to change it.',
}: {
  title?: string;
  description?: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-secondary px-4 py-3">
      <p className="text-sm font-medium text-text-primary">{title}</p>
      <p className="mt-1 text-xs text-text-tertiary">{description}</p>
    </div>
  );
}

import React from 'react';

export default function EmptyState({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-surface-secondary px-4 py-6 text-center">
      <p className="text-sm font-medium text-text-primary">{title}</p>
      {description ? (
        <p className="mt-1 text-xs text-text-tertiary">{description}</p>
      ) : null}
    </div>
  );
}

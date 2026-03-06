import React from 'react';

export default function ErrorState({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="rounded-xl border border-error/20 bg-error/5 px-4 py-3">
      <p className="text-sm font-medium text-error">{title}</p>
      {description ? (
        <p className="mt-1 text-xs text-text-tertiary">{description}</p>
      ) : null}
    </div>
  );
}

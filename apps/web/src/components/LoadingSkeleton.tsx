import React from 'react';

export default function LoadingSkeleton({
  lines = 3,
}: {
  lines?: number;
}) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, index) => (
        <div
          key={index}
          className="h-10 animate-pulse rounded-xl bg-surface-secondary"
        />
      ))}
    </div>
  );
}

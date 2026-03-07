import React from 'react';
import type { AuditLogItem } from '../api/client';
import EmptyState from './EmptyState';

export default function AuditLogList({
  items,
  onLoadMore,
  hasMore,
}: {
  items: AuditLogItem[];
  onLoadMore?: () => void;
  hasMore?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-panel p-3">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-text-primary">Audit log</p>
          <p className="mt-1 text-xs text-text-tertiary">Append-only governance events.</p>
        </div>
        <span className="text-[11px] text-text-tertiary">{items.length} items</span>
      </div>

      {items.length === 0 ? (
        <EmptyState title="No audit events yet" description="Governance events will appear here once actions occur." />
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div key={item.id} className="rounded-lg border border-border bg-surface px-3 py-2">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-text-primary">{item.summary}</p>
                  <p className="mt-1 text-[11px] text-text-tertiary">
                    {item.actorDisplay} · {item.eventType} · {item.targetType}
                  </p>
                </div>
                <span className="text-[11px] text-text-tertiary">
                  {new Date(item.createdAt).toLocaleString()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {hasMore && onLoadMore ? (
        <button
          onClick={onLoadMore}
          className="mt-3 rounded-lg border border-border px-3 py-1.5 text-xs text-text-secondary"
        >
          Load more
        </button>
      ) : null}
    </div>
  );
}

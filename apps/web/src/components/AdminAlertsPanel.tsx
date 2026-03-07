import React from 'react';
import type { AdminAlert, SurfaceLinkTarget } from '../api/client';
import EmptyState from './EmptyState';

export default function AdminAlertsPanel({
  items,
  onOpenTarget,
  onDiscussAlert,
}: {
  items: AdminAlert[];
  onOpenTarget: (target: SurfaceLinkTarget) => void;
  onDiscussAlert?: (alert: AdminAlert) => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-panel p-3">
      <div className="mb-3">
        <p className="text-sm font-semibold text-text-primary">Admin alerts</p>
        <p className="mt-1 text-xs text-text-tertiary">Operational issues that need attention.</p>
      </div>

      {items.length === 0 ? (
        <EmptyState title="No active alerts" description="The workspace currently has no admin-level alerts." />
      ) : (
        <div className="space-y-2">
          {items.map((item) => (
            <div
              key={item.id}
              className="rounded-lg border border-border bg-surface px-3 py-2"
            >
              <div className="flex items-start justify-between gap-3">
                <button
                  type="button"
                  onClick={() => onOpenTarget(item.target)}
                  className="min-w-0 flex-1 text-left"
                >
                  <p className="text-xs font-medium text-text-primary">{item.title}</p>
                  <p className="mt-1 text-[11px] text-text-tertiary">{item.description}</p>
                </button>
                <span className={`rounded px-2 py-0.5 text-[10px] uppercase ${item.severity === 'critical' ? 'bg-error/10 text-error' : item.severity === 'warning' ? 'bg-yellow-500/10 text-yellow-700' : 'bg-surface-secondary text-text-secondary'}`}>
                  {item.severity}
                </span>
              </div>
              {onDiscussAlert ? (
                <div className="mt-2">
                  <button
                    type="button"
                    onClick={() => onDiscussAlert(item)}
                    className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-secondary"
                  >
                    Discuss
                  </button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

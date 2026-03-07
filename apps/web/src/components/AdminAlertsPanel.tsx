import React from 'react';
import type { AdminAlert, SurfaceLinkTarget } from '../api/client';
import EmptyState from './EmptyState';

export default function AdminAlertsPanel({
  items,
  onOpenTarget,
}: {
  items: AdminAlert[];
  onOpenTarget: (target: SurfaceLinkTarget) => void;
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
            <button
              key={item.id}
              onClick={() => onOpenTarget(item.target)}
              className="block w-full rounded-lg border border-border bg-surface px-3 py-2 text-left"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium text-text-primary">{item.title}</p>
                  <p className="mt-1 text-[11px] text-text-tertiary">{item.description}</p>
                </div>
                <span className={`rounded px-2 py-0.5 text-[10px] uppercase ${item.severity === 'critical' ? 'bg-error/10 text-error' : item.severity === 'warning' ? 'bg-yellow-500/10 text-yellow-700' : 'bg-surface-secondary text-text-secondary'}`}>
                  {item.severity}
                </span>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

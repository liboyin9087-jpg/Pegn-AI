import React, { useEffect, useState } from 'react';
import { getSavedView, listSavedViews, type SavedViewDetail, type SavedViewSummary } from '../api/client';
import EmptyState from './EmptyState';

export default function PinnedViewsBar({
  workspaceId,
  onApplyView,
  refreshNonce = 0,
}: {
  workspaceId?: string;
  onApplyView: (view: SavedViewDetail) => void;
  refreshNonce?: number;
}) {
  const [items, setItems] = useState<SavedViewSummary[]>([]);

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    void listSavedViews(workspaceId, { includePinned: true }).then((response) => {
      if (!active) return;
      setItems(response.items);
    }).catch(() => {
      if (!active) return;
      setItems([]);
    });
    return () => {
      active = false;
    };
  }, [refreshNonce, workspaceId]);

  if (!workspaceId) return null;

  return (
    <div className="border-b border-border px-4 py-2">
      <div className="flex items-center gap-2 overflow-x-auto">
        <span className="flex-shrink-0 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">Pinned views</span>
        {items.length === 0 ? (
          <div className="min-w-0 flex-1">
            <EmptyState title="No pinned views" description="Pin important views to reopen them quickly." />
          </div>
        ) : (
          items.map((view) => (
            <button
              key={view.id}
              type="button"
              onClick={async () => {
                if (!workspaceId) return;
                const detail = await getSavedView(workspaceId, view.id);
                onApplyView(detail);
              }}
              className="flex-shrink-0 rounded-full border border-border bg-panel px-3 py-1 text-xs text-text-secondary transition-colors hover:bg-surface-tertiary"
            >
              <span className="font-medium text-text-primary">{view.name}</span>
              <span className="ml-2 text-text-tertiary">[{view.surface}]</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

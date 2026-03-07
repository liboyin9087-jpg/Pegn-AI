import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  deleteSavedView,
  getSavedView,
  listSavedViews,
  type SavedViewDetail,
  type SavedViewScope,
  type SavedViewSummary,
  type SavedViewSurface,
} from '../api/client';
import { useOptionalAppContext, useWorkspacePermissions } from '../contexts/AppContext';
import EmptyState from './EmptyState';
import ErrorState from './ErrorState';
import LoadingSkeleton from './LoadingSkeleton';

function groupViews(items: SavedViewSummary[]) {
  return {
    personal: items.filter((item) => item.scope === 'personal'),
    workspace: items.filter((item) => item.scope === 'workspace'),
  };
}

export default function SavedViewPicker({
  open,
  workspaceId,
  surface,
  onClose,
  onApplyView,
}: {
  open: boolean;
  workspaceId?: string;
  surface: SavedViewSurface;
  onClose: () => void;
  onApplyView: (view: SavedViewDetail) => void;
}) {
  const appContext = useOptionalAppContext();
  const permissions = useWorkspacePermissions();
  const [items, setItems] = useState<SavedViewSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  const reload = useCallback(async () => {
    if (!open || !workspaceId) return;
    setLoading(true);
    setError(null);
    try {
      const response = await listSavedViews(workspaceId, { surface });
      setItems(response.items);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [open, surface, workspaceId]);

  useEffect(() => {
    void reload();
  }, [reload, reloadNonce]);

  const grouped = useMemo(() => groupViews(items), [items]);

  const canDelete = useCallback((view: SavedViewSummary) => {
    if (view.scope === 'workspace') return permissions.canManageSettings;
    return appContext?.user?.id === view.ownerUserId;
  }, [appContext?.user?.id, permissions.canManageSettings]);

  if (!open) return null;

  return (
    <div className="absolute right-0 top-full z-50 mt-2 w-[22rem] rounded-2xl border border-border bg-surface p-3 shadow-2xl">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-text-primary">Saved views</p>
          <p className="text-xs text-text-tertiary">Surface: {surface}</p>
        </div>
        <button type="button" onClick={onClose} className="text-xs text-text-tertiary hover:text-text-primary">
          Close
        </button>
      </div>

      {loading ? <LoadingSkeleton lines={4} /> : null}
      {!loading && error ? (
        <ErrorState title="Failed to load saved views" description={error} />
      ) : null}
      {!loading && !error && items.length === 0 ? (
        <EmptyState title="No saved views" description="Save the current workspace view to reuse it later." />
      ) : null}

      {!loading && !error && items.length > 0 ? (
        <div className="space-y-3">
          {(['personal', 'workspace'] as SavedViewScope[]).map((scope) => {
            const scopedItems = grouped[scope];
            if (scopedItems.length === 0) return null;
            return (
              <div key={scope}>
                <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-text-tertiary">
                  {scope === 'personal' ? 'Personal' : 'Workspace'}
                </p>
                <div className="space-y-2">
                  {scopedItems.map((view) => (
                    <div key={view.id} className="rounded-xl border border-border bg-panel p-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <p className="truncate text-sm font-medium text-text-primary">{view.name}</p>
                            {view.isPinned ? (
                              <span className="rounded-full bg-accent-light px-2 py-0.5 text-[10px] text-accent">Pinned</span>
                            ) : null}
                            {view.isDefault ? (
                              <span className="rounded-full bg-surface-secondary px-2 py-0.5 text-[10px] text-text-secondary">Default</span>
                            ) : null}
                          </div>
                          {view.description ? (
                            <p className="mt-1 line-clamp-2 text-xs text-text-secondary">{view.description}</p>
                          ) : null}
                          <p className="mt-2 text-[11px] text-text-tertiary">
                            Updated {new Date(view.updatedAt).toLocaleString()}
                          </p>
                        </div>
                        <div className="flex flex-col gap-2">
                          <button
                            type="button"
                            onClick={async () => {
                              if (!workspaceId) return;
                              const detail = await getSavedView(workspaceId, view.id);
                              onApplyView(detail);
                              onClose();
                            }}
                            className="rounded-lg bg-accent px-2.5 py-1 text-[11px] font-medium text-white"
                          >
                            Apply
                          </button>
                          {canDelete(view) ? (
                            <button
                              type="button"
                              disabled={pendingDeleteId === view.id}
                              onClick={async () => {
                                if (!workspaceId) return;
                                setPendingDeleteId(view.id);
                                try {
                                  await deleteSavedView(workspaceId, view.id);
                                  setReloadNonce((current) => current + 1);
                                } finally {
                                  setPendingDeleteId(null);
                                }
                              }}
                              className="rounded-lg border border-border px-2.5 py-1 text-[11px] text-text-secondary disabled:opacity-60"
                            >
                              Delete
                            </button>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

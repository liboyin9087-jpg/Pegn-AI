import React, { useEffect, useMemo, useState } from 'react';
import {
  createSavedView,
  type SavedViewPayload,
  type SavedViewScope,
  type SavedViewSurface,
} from '../api/client';
import { useWorkspacePermissions } from '../contexts/AppContext';

function defaultName(surface: SavedViewSurface) {
  switch (surface) {
    case 'search':
      return 'Saved search';
    case 'operations':
      return 'Saved operations view';
    case 'agent':
      return 'Saved agent view';
    case 'inbox':
      return 'Saved inbox view';
    case 'admin':
      return 'Saved admin view';
  }
}

export default function SaveCurrentViewDialog({
  open,
  workspaceId,
  surface,
  payload,
  onClose,
  onSaved,
}: {
  open: boolean;
  workspaceId?: string;
  surface: SavedViewSurface;
  payload: SavedViewPayload | null;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const permissions = useWorkspacePermissions();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [scope, setScope] = useState<SavedViewScope>('personal');
  const [isPinned, setIsPinned] = useState(false);
  const [isDefault, setIsDefault] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canCreateWorkspaceView = permissions.canManageSettings;
  const effectivePayload = useMemo(() => payload, [payload]);

  useEffect(() => {
    if (!open) return;
    setName(defaultName(surface));
    setDescription('');
    setScope('personal');
    setIsPinned(false);
    setIsDefault(false);
    setError(null);
  }, [open, surface]);

  if (!open) return null;

  return (
    <div className="absolute right-0 top-full z-50 mt-2 w-[24rem] rounded-2xl border border-border bg-surface p-4 shadow-2xl">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-text-primary">Save current view</p>
          <p className="text-xs text-text-tertiary">Surface: {surface}</p>
        </div>
        <button type="button" onClick={onClose} className="text-xs text-text-tertiary hover:text-text-primary">
          Close
        </button>
      </div>

      {!effectivePayload ? (
        <p className="text-sm text-text-secondary">This surface does not have a capturable context yet.</p>
      ) : (
        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-secondary">Name</span>
            <input
              aria-label="Name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-xl border border-border bg-panel px-3 py-2 text-sm text-text-primary"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-secondary">Description</span>
            <textarea
              aria-label="Description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={3}
              className="w-full rounded-xl border border-border bg-panel px-3 py-2 text-sm text-text-primary"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-medium text-text-secondary">Scope</span>
            <select
              aria-label="Scope"
              value={scope}
              onChange={(event) => setScope(event.target.value as SavedViewScope)}
              className="w-full rounded-xl border border-border bg-panel px-3 py-2 text-sm text-text-primary"
            >
              <option value="personal">Personal</option>
              <option value="workspace" disabled={!canCreateWorkspaceView}>Workspace</option>
            </select>
            {!canCreateWorkspaceView ? (
              <p className="mt-1 text-[11px] text-text-tertiary">Only workspace admins can create shared views.</p>
            ) : null}
          </label>

          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input type="checkbox" checked={isPinned} onChange={(event) => setIsPinned(event.target.checked)} />
            Pin this view
          </label>
          <label className="flex items-center gap-2 text-sm text-text-secondary">
            <input type="checkbox" checked={isDefault} onChange={(event) => setIsDefault(event.target.checked)} />
            Set as my default view
          </label>

          {error ? <p className="text-xs text-error">{error}</p> : null}

          <div className="flex justify-end gap-2">
            <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-2 text-xs text-text-secondary">
              Cancel
            </button>
            <button
              type="button"
              disabled={saving || !workspaceId || !effectivePayload || !name.trim() || (scope === 'workspace' && !canCreateWorkspaceView)}
              onClick={async () => {
                if (!workspaceId || !effectivePayload) return;
                setSaving(true);
                setError(null);
                try {
                  await createSavedView(workspaceId, {
                    scope,
                    surface,
                    name: name.trim(),
                    description: description.trim() || null,
                    contextVersion: 1,
                    payload: effectivePayload,
                    isPinned,
                    isDefault,
                  });
                  onSaved?.();
                  onClose();
                } catch (nextError) {
                  setError(nextError instanceof Error ? nextError.message : 'Failed to save view');
                } finally {
                  setSaving(false);
                }
              }}
              className="rounded-lg bg-accent px-3 py-2 text-xs font-medium text-white disabled:opacity-60"
            >
              {saving ? 'Saving...' : 'Save view'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

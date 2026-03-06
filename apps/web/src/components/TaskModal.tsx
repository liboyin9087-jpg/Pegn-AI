/**
 * TaskModal — 新增 / 編輯 Collection 項目的 CRUD 彈窗
 *
 * 使用 AppContext：showTaskModal, editingItem, closeTaskModal, workspace, activeCollection
 * 使用 useCollectionDocuments：addDocument, editDocument
 */

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Plus, Save, Loader2 } from 'lucide-react';
import { useAppContext } from '../contexts/AppContext';
import { useCollectionDocuments } from '../hooks/useCollections';

// ─── 欄位定義 ────────────────────────────────────────────────
const STATUS_OPTIONS = ['未開始', '進行中', '已完成', '已取消'];
const PRIORITY_OPTIONS = ['低', '中', '高', '緊急'];

// ─── 元件 ────────────────────────────────────────────────────
export default function TaskModal() {
  const {
    showTaskModal,
    editingItem,
    closeTaskModal,
    workspace,
    activeCollection,
  } = useAppContext();

  const collectionId = activeCollection?.id;
  const { addDocument, editDocument } = useCollectionDocuments(collectionId);

  // ── form state ──
  const [name, setName] = useState('');
  const [status, setStatus] = useState(STATUS_OPTIONS[0]);
  const [priority, setPriority] = useState(PRIORITY_OPTIONS[1]);
  const [dueDate, setDueDate] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 當 editingItem 改變時填入既有值
  useEffect(() => {
    if (editingItem) {
      setName(editingItem.properties?.名稱 ?? editingItem.title ?? '');
      setStatus(editingItem.properties?.狀態 ?? STATUS_OPTIONS[0]);
      setPriority(editingItem.properties?.優先級 ?? PRIORITY_OPTIONS[1]);
      setDueDate(editingItem.properties?.截止日期 ?? '');
    } else {
      setName('');
      setStatus(STATUS_OPTIONS[0]);
      setPriority(PRIORITY_OPTIONS[1]);
      setDueDate('');
    }
    setError(null);
  }, [editingItem, showTaskModal]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('請輸入名稱'); return; }
    if (!workspace?.id) { setError('找不到 workspace'); return; }

    setSaving(true);
    setError(null);
    try {
      const props = { 名稱: name.trim(), 狀態: status, 優先級: priority, 截止日期: dueDate };

      if (editingItem) {
        // 編輯
        await editDocument(editingItem.id, {
          title: name.trim(),
          properties: { ...editingItem.properties, ...props },
        });
      } else {
        // 新增
        const doc = await addDocument(workspace.id, name.trim());
        if (doc?.id) {
          await editDocument(doc.id, { properties: props });
        }
      }
      closeTaskModal();
    } catch (err: any) {
      setError(err?.message ?? '儲存失敗，請再試一次');
    } finally {
      setSaving(false);
    }
  };

  const isEditing = Boolean(editingItem);

  return (
    <AnimatePresence>
      {showTaskModal && (
        // ── 背景遮罩
        <motion.div
          key="task-modal-backdrop"
          className="fixed inset-0 z-50 flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.45)' }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onMouseDown={(e: React.MouseEvent<HTMLDivElement>) => { if (e.target === e.currentTarget) closeTaskModal(); }}
        >
          {/* ── 彈窗主體 */}
          <motion.div
            key="task-modal-panel"
            className="w-full max-w-md rounded-2xl shadow-2xl overflow-hidden"
            style={{
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
            }}
            initial={{ opacity: 0, scale: 0.95, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e: React.MouseEvent<HTMLDivElement>) => e.stopPropagation()}
          >
            {/* ── header */}
            <div className="flex items-center justify-between px-5 py-4 border-b"
              style={{ borderColor: 'var(--color-border)' }}>
              <h2 className="text-base font-semibold" style={{ color: 'var(--color-text)' }}>
                {isEditing ? '編輯項目' : '新增項目'}
              </h2>
              <button
                onClick={closeTaskModal}
                className="rounded-lg p-1.5 hover:opacity-70 transition-opacity"
                style={{ color: 'var(--color-text-muted)' }}
                aria-label="關閉"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* ── form */}
            <form onSubmit={handleSubmit} className="px-5 py-4 space-y-4">

              {/* 名稱 */}
              <div>
                <label className="block text-xs font-medium mb-1.5"
                  style={{ color: 'var(--color-text-muted)' }}>
                  名稱 <span className="text-red-400">*</span>
                </label>
                <input
                  type="text"
                  value={name}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
                  placeholder="輸入任務名稱..."
                  autoFocus
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/50"
                  style={{
                    background: 'var(--color-surface-hover)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-text)',
                  }}
                />
              </div>

              {/* 狀態 + 優先級 (並排) */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium mb-1.5"
                    style={{ color: 'var(--color-text-muted)' }}>
                    狀態
                  </label>
                  <select
                    value={status}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setStatus(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/50"
                    style={{
                      background: 'var(--color-surface-hover)',
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-text)',
                    }}
                  >
                    {STATUS_OPTIONS.map(o => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium mb-1.5"
                    style={{ color: 'var(--color-text-muted)' }}>
                    優先級
                  </label>
                  <select
                    value={priority}
                    onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setPriority(e.target.value)}
                    className="w-full px-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/50"
                    style={{
                      background: 'var(--color-surface-hover)',
                      border: '1px solid var(--color-border)',
                      color: 'var(--color-text)',
                    }}
                  >
                    {PRIORITY_OPTIONS.map(o => (
                      <option key={o} value={o}>{o}</option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 截止日期 */}
              <div>
                <label className="block text-xs font-medium mb-1.5"
                  style={{ color: 'var(--color-text-muted)' }}>
                  截止日期
                </label>
                <input
                  type="date"
                  value={dueDate}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDueDate(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500/50"
                  style={{
                    background: 'var(--color-surface-hover)',
                    border: '1px solid var(--color-border)',
                    color: 'var(--color-text)',
                  }}
                />
              </div>

              {/* 錯誤訊息 */}
              {error && (
                <p className="text-xs text-red-400">{error}</p>
              )}

              {/* 操作按鈕 */}
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={closeTaskModal}
                  disabled={saving}
                  className="px-4 py-2 text-sm rounded-lg transition-opacity hover:opacity-70"
                  style={{
                    color: 'var(--color-text-muted)',
                    border: '1px solid var(--color-border)',
                    background: 'transparent',
                  }}
                >
                  取消
                </button>
                <button
                  type="submit"
                  disabled={saving || !name.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-50 transition-colors"
                >
                  {saving ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : isEditing ? (
                    <Save className="w-3.5 h-3.5" />
                  ) : (
                    <Plus className="w-3.5 h-3.5" />
                  )}
                  {saving ? '儲存中…' : isEditing ? '儲存變更' : '新增項目'}
                </button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

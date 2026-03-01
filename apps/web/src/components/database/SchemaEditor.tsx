import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, Plus, GripVertical, Trash2, ChevronDown,
  Type, Hash, Calendar, CheckSquare, Link, Mail, Phone, List, ToggleLeft,
} from 'lucide-react';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable, type DragEndEvent,
} from '@dnd-kit/core';
import { Collection, CollectionProperty } from '../../types/collection';

const PROP_TYPES: { value: CollectionProperty['type']; label: string; icon: React.ReactNode }[] = [
  { value: 'text',         label: '文字',     icon: <Type size={13} /> },
  { value: 'number',       label: '數字',     icon: <Hash size={13} /> },
  { value: 'select',       label: '單選',     icon: <ToggleLeft size={13} /> },
  { value: 'multi_select', label: '多選',     icon: <List size={13} /> },
  { value: 'date',         label: '日期',     icon: <Calendar size={13} /> },
  { value: 'checkbox',     label: '勾選框',   icon: <CheckSquare size={13} /> },
  { value: 'url',          label: 'URL',      icon: <Link size={13} /> },
  { value: 'email',        label: 'Email',    icon: <Mail size={13} /> },
  { value: 'phone',        label: '電話',     icon: <Phone size={13} /> },
];

interface PropEntry { id: string; prop: CollectionProperty; }

function PropTypeSelect({
  value, onChange,
}: { value: CollectionProperty['type']; onChange: (v: CollectionProperty['type']) => void }) {
  const [open, setOpen] = useState(false);
  const current = PROP_TYPES.find(t => t.value === value);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs transition-colors"
        style={{
          background: 'var(--color-surface-secondary)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-secondary)',
          minWidth: 90,
        }}
      >
        {current?.icon}
        <span className="flex-1 text-left">{current?.label}</span>
        <ChevronDown size={10} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.1 }}
            className="absolute left-0 z-50 py-1 rounded-xl"
            style={{
              top: '100%',
              marginTop: 4,
              background: 'var(--color-surface)',
              border: '1px solid var(--color-border)',
              boxShadow: 'var(--shadow-lg)',
              minWidth: 130,
            }}
          >
            {PROP_TYPES.map(t => (
              <button
                key={t.value}
                onClick={() => { onChange(t.value); setOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors text-left"
                style={{
                  background: t.value === value ? 'var(--color-accent-light)' : 'transparent',
                  color: t.value === value ? 'var(--color-accent)' : 'var(--color-text-secondary)',
                }}
                onMouseEnter={e => { if (t.value !== value) (e.currentTarget as HTMLElement).style.background = 'var(--color-surface-secondary)'; }}
                onMouseLeave={e => { if (t.value !== value) (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
              >
                {t.icon} {t.label}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function PropRow({
  entry, onRename, onChangeType, onDelete, dropInfo,
}: {
  entry: PropEntry;
  onRename: (id: string, name: string) => void;
  onChangeType: (id: string, type: CollectionProperty['type']) => void;
  onDelete: (id: string) => void;
  dropInfo: { id: string; edge: 'before' | 'after' } | null;
}) {
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({ id: entry.id });
  const { setNodeRef: setDropRef } = useDroppable({ id: entry.id });

  const isDropBefore = dropInfo?.id === entry.id && dropInfo.edge === 'before';
  const isDropAfter  = dropInfo?.id === entry.id && dropInfo.edge === 'after';

  return (
    <div style={{ opacity: isDragging ? 0.3 : 1 }}>
      {isDropBefore && <div style={{ height: 2, background: 'var(--color-accent)', borderRadius: 1, margin: '0 8px 2px' }} />}
      <div
        ref={setDropRef}
        className="flex items-center gap-2 px-2 py-2 rounded-lg group"
        style={{ background: 'var(--color-surface-secondary)', marginBottom: 4 }}
      >
        <span
          ref={setDragRef}
          {...attributes}
          {...listeners}
          className="cursor-grab active:cursor-grabbing flex-shrink-0"
          style={{ color: 'var(--color-text-quaternary)', touchAction: 'none' }}
        >
          <GripVertical size={13} />
        </span>
        <input
          value={entry.prop.name}
          onChange={e => onRename(entry.id, e.target.value)}
          className="flex-1 bg-transparent outline-none text-sm min-w-0"
          style={{ color: 'var(--color-text-primary)', fontSize: 13 }}
          placeholder="欄位名稱"
        />
        <PropTypeSelect
          value={entry.prop.type}
          onChange={type => onChangeType(entry.id, type)}
        />
        <button
          onClick={() => onDelete(entry.id)}
          className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ color: 'var(--color-error)' }}
        >
          <Trash2 size={13} />
        </button>
      </div>
      {isDropAfter && <div style={{ height: 2, background: 'var(--color-accent)', borderRadius: 1, margin: '2px 8px 0' }} />}
    </div>
  );
}

interface SchemaEditorProps {
  collection: Collection;
  onSave: (schema: { properties: Record<string, CollectionProperty> }) => void;
  onClose: () => void;
}

export function SchemaEditor({ collection, onSave, onClose }: SchemaEditorProps) {
  // Convert to ordered array for manipulation
  const [entries, setEntries] = useState<PropEntry[]>(() =>
    Object.entries(collection.schema.properties).map(([id, prop]) => ({ id, prop }))
  );
  const [saving, setSaving] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropInfo, setDropInfo] = useState<{ id: string; edge: 'before' | 'after' } | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const handleRename = useCallback((id: string, name: string) => {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, prop: { ...e.prop, name } } : e));
  }, []);

  const handleChangeType = useCallback((id: string, type: CollectionProperty['type']) => {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, prop: { ...e.prop, type } } : e));
  }, []);

  const handleDelete = useCallback((id: string) => {
    setEntries(prev => prev.filter(e => e.id !== id));
  }, []);

  const handleAdd = () => {
    const newId = `prop_${Date.now()}`;
    setEntries(prev => [...prev, { id: newId, prop: { name: '新欄位', type: 'text' } }]);
  };

  const handleDragOver = ({ active, over }: any) => {
    if (!over || active.id === over.id) { setDropInfo(null); return; }
    const activeIdx = entries.findIndex(e => e.id === active.id);
    const overIdx   = entries.findIndex(e => e.id === over.id);
    setDropInfo({ id: over.id as string, edge: activeIdx > overIdx ? 'before' : 'after' });
  };

  const handleDragEnd = ({ active, over }: DragEndEvent) => {
    setDraggingId(null);
    setDropInfo(null);
    if (!over || active.id === over.id) return;
    const oldIdx = entries.findIndex(e => e.id === active.id);
    const newIdx = entries.findIndex(e => e.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    const next = [...entries];
    const [moved] = next.splice(oldIdx, 1);
    next.splice(newIdx, 0, moved);
    setEntries(next);
  };

  const handleSave = async () => {
    setSaving(true);
    const properties: Record<string, CollectionProperty> = {};
    for (const { id, prop } of entries) properties[id] = prop;
    await onSave({ properties });
    setSaving(false);
    onClose();
  };

  const draggingEntry = draggingId ? entries.find(e => e.id === draggingId) : null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-start justify-end"
      style={{ background: 'rgba(0,0,0,0.25)' }}
      onClick={onClose}
    >
      <motion.div
        initial={{ x: 360 }}
        animate={{ x: 0 }}
        exit={{ x: 360 }}
        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
        className="h-full flex flex-col"
        style={{
          width: 360,
          background: 'var(--color-surface)',
          borderLeft: '1px solid var(--color-border)',
          boxShadow: 'var(--shadow-xl)',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-4 py-3 flex-shrink-0"
          style={{ borderBottom: '1px solid var(--color-border)' }}
        >
          <div>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>Schema 設定</p>
            <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 1 }}>{collection.name}</p>
          </div>
          <button onClick={onClose} style={{ color: 'var(--color-text-tertiary)' }}>
            <X size={16} />
          </button>
        </div>

        {/* Property list */}
        <div className="flex-1 overflow-y-auto p-4">
          <p style={{ fontSize: 11, color: 'var(--color-text-quaternary)', fontWeight: 500, letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>
            屬性 ({entries.length})
          </p>
          <DndContext
            sensors={sensors}
            onDragStart={({ active }) => setDraggingId(String(active.id))}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
          >
            {entries.map(entry => (
              <PropRow
                key={entry.id}
                entry={entry}
                onRename={handleRename}
                onChangeType={handleChangeType}
                onDelete={handleDelete}
                dropInfo={dropInfo}
              />
            ))}
            <DragOverlay dropAnimation={{ duration: 150, easing: 'ease' }}>
              {draggingEntry && (
                <div
                  className="flex items-center gap-2 px-3 py-2 rounded-lg"
                  style={{ background: 'var(--color-surface)', border: '1.5px solid var(--color-accent)', boxShadow: 'var(--shadow-lg)', fontSize: 13 }}
                >
                  <GripVertical size={13} style={{ color: 'var(--color-text-quaternary)' }} />
                  <span style={{ color: 'var(--color-text-primary)' }}>{draggingEntry.prop.name}</span>
                </div>
              )}
            </DragOverlay>
          </DndContext>

          <button
            onClick={handleAdd}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg mt-2 transition-colors text-sm"
            style={{ color: 'var(--color-text-tertiary)', border: '1px dashed var(--color-border)' }}
            onMouseEnter={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-accent)'; (e.currentTarget as HTMLElement).style.color = 'var(--color-accent)'; }}
            onMouseLeave={e => { (e.currentTarget as HTMLElement).style.borderColor = 'var(--color-border)'; (e.currentTarget as HTMLElement).style.color = 'var(--color-text-tertiary)'; }}
          >
            <Plus size={13} /> 新增屬性
          </button>
        </div>

        {/* Footer */}
        <div
          className="px-4 py-3 flex gap-2 flex-shrink-0"
          style={{ borderTop: '1px solid var(--color-border)' }}
        >
          <button
            onClick={onClose}
            className="flex-1 px-3 py-2 rounded-lg text-sm transition-colors"
            style={{ background: 'var(--color-surface-secondary)', color: 'var(--color-text-secondary)' }}
          >
            取消
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex-1 px-3 py-2 rounded-lg text-sm text-white transition-opacity"
            style={{ background: 'var(--color-accent)', opacity: saving ? 0.7 : 1 }}
          >
            {saving ? '儲存中...' : '儲存'}
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

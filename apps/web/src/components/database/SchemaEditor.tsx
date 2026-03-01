import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  X, Plus, GripVertical, Trash2, ChevronDown,
  Type, Hash, Calendar, CheckSquare, Link, Mail, Phone, List, ToggleLeft,
  Sigma, ExternalLink, BarChart2, ChevronRight,
} from 'lucide-react';
import {
  DndContext, DragOverlay, PointerSensor, useSensor, useSensors,
  useDraggable, useDroppable, type DragEndEvent,
} from '@dnd-kit/core';
import { Collection, CollectionProperty } from '../../types/collection';

const PROP_TYPES: { value: CollectionProperty['type']; label: string; icon: React.ReactNode }[] = [
  { value: 'text',         label: '文字',   icon: <Type size={13} /> },
  { value: 'number',       label: '數字',   icon: <Hash size={13} /> },
  { value: 'select',       label: '單選',   icon: <ToggleLeft size={13} /> },
  { value: 'multi_select', label: '多選',   icon: <List size={13} /> },
  { value: 'date',         label: '日期',   icon: <Calendar size={13} /> },
  { value: 'checkbox',     label: '勾選框', icon: <CheckSquare size={13} /> },
  { value: 'url',          label: 'URL',    icon: <Link size={13} /> },
  { value: 'email',        label: 'Email',  icon: <Mail size={13} /> },
  { value: 'phone',        label: '電話',   icon: <Phone size={13} /> },
  { value: 'formula',      label: '公式',   icon: <Sigma size={13} /> },
  { value: 'relation',     label: '關聯',   icon: <ExternalLink size={13} /> },
  { value: 'rollup',       label: 'Rollup', icon: <BarChart2 size={13} /> },
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
        style={{ background: 'var(--color-surface-secondary)', border: '1px solid var(--color-border)', color: 'var(--color-text-secondary)', minWidth: 90 }}
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
            style={{ top: '100%', marginTop: 4, background: 'var(--color-surface)', border: '1px solid var(--color-border)', boxShadow: 'var(--shadow-lg)', minWidth: 130 }}
          >
            {PROP_TYPES.map(t => (
              <button
                key={t.value}
                onClick={() => { onChange(t.value); setOpen(false); }}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-xs transition-colors text-left"
                style={{ background: t.value === value ? 'var(--color-accent-light)' : 'transparent', color: t.value === value ? 'var(--color-accent)' : 'var(--color-text-secondary)' }}
                onMouseEnter={e => { if (t.value !== value) e.currentTarget.style.background = 'var(--color-surface-secondary)'; }}
                onMouseLeave={e => { if (t.value !== value) e.currentTarget.style.background = 'transparent'; }}
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

// ── Config section rendered inside PropRow for formula / relation / rollup ───

function PropConfig({
  entry,
  onChangeProp,
  collections,
  allEntries,
}: {
  entry: PropEntry;
  onChangeProp: (id: string, prop: CollectionProperty) => void;
  collections: Collection[];
  allEntries: PropEntry[];
}) {
  const { id, prop } = entry;
  const update = (patch: Partial<CollectionProperty>) =>
    onChangeProp(id, { ...prop, ...patch });

  // ── Formula config ─────────────────────────────────────────────────────
  if (prop.type === 'formula') {
    return (
      <div className="mt-2 pl-1 pr-1">
        <label style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--color-text-quaternary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          公式表達式
        </label>
        <input
          className="w-full mt-1 px-2 py-1.5 rounded-lg text-xs outline-none"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)', fontFamily: 'monospace' }}
          placeholder='例：prop("Price") * prop("Qty")'
          value={prop.formula ?? ''}
          onChange={e => update({ formula: e.target.value })}
        />
        <p style={{ fontSize: 10, color: 'var(--color-text-quaternary)', marginTop: 4 }}>
          prop("名稱") &nbsp;·&nbsp; + - * / &nbsp;·&nbsp; & 字串連接 &nbsp;·&nbsp; if(條件, 是, 否) &nbsp;·&nbsp; now()
        </p>
      </div>
    );
  }

  // ── Relation config ────────────────────────────────────────────────────
  if (prop.type === 'relation') {
    return (
      <div className="mt-2 pl-1 pr-1">
        <label style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--color-text-quaternary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          目標資料庫
        </label>
        <select
          className="w-full mt-1 px-2 py-1.5 rounded-lg text-xs outline-none"
          style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
          value={prop.relation?.targetCollectionId ?? ''}
          onChange={e => {
            const target = collections.find(c => c.id === e.target.value);
            update({ relation: { targetCollectionId: e.target.value, targetCollectionName: target?.name } });
          }}
        >
          <option value="">— 選擇資料庫 —</option>
          {collections.map(c => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>
    );
  }

  // ── Rollup config ──────────────────────────────────────────────────────
  if (prop.type === 'rollup') {
    const relationEntries = allEntries.filter(e => e.prop.type === 'relation');
    const selectedRelation = allEntries.find(e => e.id === prop.rollup?.relationPropId);
    const targetCollectionId = selectedRelation?.prop.relation?.targetCollectionId;
    const targetCollection = collections.find(c => c.id === targetCollectionId);
    const targetProps = targetCollection ? Object.entries(targetCollection.schema.properties) : [];

    return (
      <div className="mt-2 pl-1 pr-1 flex flex-col gap-2">
        {/* Relation prop picker */}
        <div>
          <label style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--color-text-quaternary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            關聯欄位
          </label>
          <select
            className="w-full mt-1 px-2 py-1.5 rounded-lg text-xs outline-none"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
            value={prop.rollup?.relationPropId ?? ''}
            onChange={e => update({ rollup: { ...prop.rollup ?? { targetPropId: '', aggregation: 'count' }, relationPropId: e.target.value } })}
          >
            <option value="">— 選擇關聯欄位 —</option>
            {relationEntries.map(e => (
              <option key={e.id} value={e.id}>{e.prop.name}</option>
            ))}
          </select>
        </div>

        {/* Target prop picker */}
        <div>
          <label style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--color-text-quaternary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            目標欄位
          </label>
          <select
            className="w-full mt-1 px-2 py-1.5 rounded-lg text-xs outline-none"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
            value={prop.rollup?.targetPropId ?? ''}
            onChange={e => update({ rollup: { ...prop.rollup ?? { relationPropId: '', aggregation: 'count' }, targetPropId: e.target.value } })}
          >
            <option value="">— 選擇目標欄位 —</option>
            {targetProps.map(([tid, tp]) => (
              <option key={tid} value={tid}>{tp.name}</option>
            ))}
          </select>
        </div>

        {/* Aggregation picker */}
        <div>
          <label style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--color-text-quaternary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            計算方式
          </label>
          <select
            className="w-full mt-1 px-2 py-1.5 rounded-lg text-xs outline-none"
            style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', color: 'var(--color-text-primary)' }}
            value={prop.rollup?.aggregation ?? 'count'}
            onChange={e => update({ rollup: { ...prop.rollup ?? { relationPropId: '', targetPropId: '' }, aggregation: e.target.value as any } })}
          >
            <option value="count">Count（個數）</option>
            <option value="sum">Sum（合計）</option>
            <option value="avg">Avg（平均）</option>
            <option value="min">Min（最小）</option>
            <option value="max">Max（最大）</option>
          </select>
        </div>
      </div>
    );
  }

  return null;
}

// ── PropRow ──────────────────────────────────────────────────────────────────

function PropRow({
  entry, allEntries, onChangeProp, onDelete, dropInfo, collections,
}: {
  entry: PropEntry;
  allEntries: PropEntry[];
  onChangeProp: (id: string, prop: CollectionProperty) => void;
  onDelete: (id: string) => void;
  dropInfo: { id: string; edge: 'before' | 'after' } | null;
  collections: Collection[];
}) {
  const { attributes, listeners, setNodeRef: setDragRef, isDragging } = useDraggable({ id: entry.id });
  const { setNodeRef: setDropRef } = useDroppable({ id: entry.id });
  const [configOpen, setConfigOpen] = useState(false);

  const isDropBefore = dropInfo?.id === entry.id && dropInfo.edge === 'before';
  const isDropAfter  = dropInfo?.id === entry.id && dropInfo.edge === 'after';
  const hasConfig = ['formula', 'relation', 'rollup'].includes(entry.prop.type);

  return (
    <div style={{ opacity: isDragging ? 0.3 : 1 }}>
      {isDropBefore && <div style={{ height: 2, background: 'var(--color-accent)', borderRadius: 1, margin: '0 8px 2px' }} />}
      <div
        ref={setDropRef}
        className="rounded-lg group overflow-hidden"
        style={{ background: 'var(--color-surface-secondary)', marginBottom: 4 }}
      >
        {/* Row header */}
        <div className="flex items-center gap-2 px-2 py-2">
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
            onChange={e => onChangeProp(entry.id, { ...entry.prop, name: e.target.value })}
            className="flex-1 bg-transparent outline-none text-sm min-w-0"
            style={{ color: 'var(--color-text-primary)', fontSize: 13 }}
            placeholder="欄位名稱"
          />
          <PropTypeSelect
            value={entry.prop.type}
            onChange={type => onChangeProp(entry.id, { ...entry.prop, type })}
          />
          {/* Config toggle for complex types */}
          {hasConfig && (
            <button
              onClick={() => setConfigOpen(o => !o)}
              style={{ color: configOpen ? 'var(--color-accent)' : 'var(--color-text-quaternary)', flexShrink: 0 }}
            >
              <ChevronRight size={13} style={{ transform: configOpen ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s' }} />
            </button>
          )}
          <button
            onClick={() => onDelete(entry.id)}
            className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            style={{ color: 'var(--color-error)' }}
          >
            <Trash2 size={13} />
          </button>
        </div>

        {/* Config section */}
        <AnimatePresence>
          {hasConfig && configOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="overflow-hidden"
              style={{ borderTop: '1px solid var(--color-border)' }}
            >
              <div className="px-3 pb-3">
                <PropConfig
                  entry={entry}
                  onChangeProp={onChangeProp}
                  collections={collections}
                  allEntries={allEntries}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      {isDropAfter && <div style={{ height: 2, background: 'var(--color-accent)', borderRadius: 1, margin: '2px 8px 0' }} />}
    </div>
  );
}

// ── SchemaEditor ─────────────────────────────────────────────────────────────

interface SchemaEditorProps {
  collection: Collection;
  collections: Collection[];
  onSave: (schema: { properties: Record<string, CollectionProperty> }) => void;
  onClose: () => void;
}

export function SchemaEditor({ collection, collections, onSave, onClose }: SchemaEditorProps) {
  const [entries, setEntries] = useState<PropEntry[]>(() =>
    Object.entries(collection.schema.properties).map(([id, prop]) => ({ id, prop }))
  );
  const [saving, setSaving] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropInfo, setDropInfo] = useState<{ id: string; edge: 'before' | 'after' } | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const handleChangeProp = useCallback((id: string, prop: CollectionProperty) => {
    setEntries(prev => prev.map(e => e.id === id ? { ...e, prop } : e));
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
        style={{ width: 360, background: 'var(--color-surface)', borderLeft: '1px solid var(--color-border)', boxShadow: 'var(--shadow-xl)' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 flex-shrink-0" style={{ borderBottom: '1px solid var(--color-border)' }}>
          <div>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}>Schema 設定</p>
            <p style={{ fontSize: 12, color: 'var(--color-text-tertiary)', marginTop: 1 }}>{collection.name}</p>
          </div>
          <button onClick={onClose} style={{ color: 'var(--color-text-tertiary)' }}><X size={16} /></button>
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
                allEntries={entries}
                onChangeProp={handleChangeProp}
                onDelete={handleDelete}
                dropInfo={dropInfo}
                collections={collections}
              />
            ))}
            <DragOverlay dropAnimation={{ duration: 150, easing: 'ease' }}>
              {draggingEntry && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg" style={{ background: 'var(--color-surface)', border: '1.5px solid var(--color-accent)', boxShadow: 'var(--shadow-lg)', fontSize: 13 }}>
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
            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--color-accent)'; e.currentTarget.style.color = 'var(--color-accent)'; }}
            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--color-border)'; e.currentTarget.style.color = 'var(--color-text-tertiary)'; }}
          >
            <Plus size={13} /> 新增屬性
          </button>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 flex gap-2 flex-shrink-0" style={{ borderTop: '1px solid var(--color-border)' }}>
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

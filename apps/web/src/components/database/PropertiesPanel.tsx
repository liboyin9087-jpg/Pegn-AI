import React, { useState } from 'react';
import { motion } from 'motion/react';
import {
  X, ExternalLink, Type, Hash, Calendar as CalendarIcon,
  CheckSquare, Link, Mail, Phone, List, ToggleLeft,
} from 'lucide-react';
import { Collection, CollectionProperty } from '../../types/collection';

const PropTypeIcon = ({ type }: { type: CollectionProperty['type'] }) => {
  switch (type) {
    case 'text':         return <Type size={13} />;
    case 'number':       return <Hash size={13} />;
    case 'select':       return <ToggleLeft size={13} />;
    case 'multi_select': return <List size={13} />;
    case 'date':         return <CalendarIcon size={13} />;
    case 'checkbox':     return <CheckSquare size={13} />;
    case 'url':          return <Link size={13} />;
    case 'email':        return <Mail size={13} />;
    case 'phone':        return <Phone size={13} />;
    default:             return <Type size={13} />;
  }
};

function PropertyField({
  propId, prop, value, onChange,
}: {
  propId: string;
  prop: CollectionProperty;
  value: any;
  onChange: (propId: string, val: any) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [tempVal, setTempVal] = useState(value);

  const commit = () => {
    setEditing(false);
    if (tempVal !== value) onChange(propId, tempVal);
  };

  if (prop.type === 'checkbox') {
    return (
      <input
        type="checkbox"
        checked={!!value}
        onChange={e => onChange(propId, e.target.checked)}
        className="w-4 h-4 rounded accent-accent"
      />
    );
  }

  if (prop.type === 'date') {
    return (
      <input
        type="date"
        value={value ? String(value).slice(0, 10) : ''}
        onChange={e => onChange(propId, e.target.value)}
        className="text-sm outline-none border-b transition-colors"
        style={{
          borderColor: 'var(--color-border)',
          color: 'var(--color-text-primary)',
          background: 'transparent',
          fontSize: 13,
        }}
      />
    );
  }

  if (prop.type === 'select' && prop.options?.length) {
    return (
      <select
        value={value || ''}
        onChange={e => onChange(propId, e.target.value)}
        className="text-sm outline-none rounded-md px-2 py-1"
        style={{
          background: 'var(--color-surface-secondary)',
          border: '1px solid var(--color-border)',
          color: 'var(--color-text-primary)',
          fontSize: 13,
        }}
      >
        <option value="">— 未選擇 —</option>
        {prop.options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    );
  }

  if (editing) {
    return (
      <input
        autoFocus
        value={tempVal || ''}
        onChange={e => setTempVal(e.target.value)}
        onBlur={commit}
        onKeyDown={e => e.key === 'Enter' && commit()}
        className="flex-1 text-sm outline-none px-1 rounded"
        style={{
          border: '1.5px solid var(--color-accent)',
          color: 'var(--color-text-primary)',
          background: 'var(--color-surface)',
          fontSize: 13,
          minWidth: 0,
          width: '100%',
        }}
      />
    );
  }

  return (
    <span
      onClick={() => { setTempVal(value); setEditing(true); }}
      className="text-sm cursor-text"
      style={{
        color: value ? 'var(--color-text-primary)' : 'var(--color-text-placeholder)',
        fontSize: 13,
      }}
    >
      {value != null && value !== '' ? String(value) : '空白'}
    </span>
  );
}

interface PropertiesPanelProps {
  rowId: string | null;
  data: any[];
  collection: Collection;
  onClose: () => void;
  onEditCell: (rowId: string, propId: string, val: any) => void;
  onOpenFullPage?: (rowId: string) => void;
}

export function PropertiesPanel({
  rowId, data, collection, onClose, onEditCell, onOpenFullPage,
}: PropertiesPanelProps) {
  const row = data.find(d => d.id === rowId);
  const properties = Object.entries(collection.schema.properties);

  return (
    <motion.div
      initial={{ x: 400, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 400, opacity: 0 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
      className="h-full flex flex-col flex-shrink-0"
      style={{
        width: 380,
        background: 'var(--color-surface)',
        borderLeft: '1px solid var(--color-border)',
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      {/* Header */}
      <div
        className="flex items-center justify-between px-4 py-3 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border)' }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span style={{ fontSize: 18 }}>{row?.metadata?.icon ?? '📝'}</span>
          <span
            className="truncate"
            style={{ fontSize: 14, fontWeight: 600, color: 'var(--color-text-primary)' }}
          >
            {row?.title || '未命名'}
          </span>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {onOpenFullPage && row && (
            <button
              onClick={() => onOpenFullPage(row.id)}
              title="開啟完整頁面"
              className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
              style={{ color: 'var(--color-text-tertiary)' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-secondary)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <ExternalLink size={14} />
            </button>
          )}
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors"
            style={{ color: 'var(--color-text-tertiary)' }}
            onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-secondary)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {/* Properties */}
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {!row ? (
          <div className="text-center py-12" style={{ color: 'var(--color-text-quaternary)', fontSize: 13 }}>
            無法載入此筆資料
          </div>
        ) : properties.length === 0 ? (
          <div className="text-center py-12" style={{ color: 'var(--color-text-quaternary)', fontSize: 13 }}>
            尚未定義任何屬性
          </div>
        ) : (
          <div className="space-y-0.5">
            {properties.map(([propId, prop]) => (
              <div
                key={propId}
                className="flex items-start py-2.5 rounded-lg px-2 group"
                style={{ minHeight: 36 }}
                onMouseEnter={e => (e.currentTarget.style.background = 'var(--color-surface-secondary)')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                {/* Label */}
                <div
                  className="flex items-center gap-1.5 flex-shrink-0"
                  style={{ width: 140, color: 'var(--color-text-tertiary)', fontSize: 12.5, paddingTop: 1 }}
                >
                  <PropTypeIcon type={prop.type} />
                  <span className="truncate">{prop.name}</span>
                </div>
                {/* Value */}
                <div className="flex-1 min-w-0">
                  {rowId && (
                    <PropertyField
                      propId={propId}
                      prop={prop}
                      value={row?.properties?.[propId]}
                      onChange={(pid, val) => onEditCell(rowId, pid, val)}
                    />
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Footer metadata */}
      {row && (
        <div
          className="px-4 py-3 flex-shrink-0"
          style={{ borderTop: '1px solid var(--color-border)', fontSize: 11, color: 'var(--color-text-quaternary)' }}
        >
          <div>建立於 {new Date(row.created_at).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short' })}</div>
          {row.updated_at && row.updated_at !== row.created_at && (
            <div>更新於 {new Date(row.updated_at).toLocaleString('zh-TW', { dateStyle: 'short', timeStyle: 'short' })}</div>
          )}
        </div>
      )}
    </motion.div>
  );
}

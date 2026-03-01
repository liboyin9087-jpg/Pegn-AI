import React, { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Plus, Search, Filter, ArrowUpDown, MoreHorizontal,
  Hash, Type, Calendar, CheckSquare, Link, Mail, Phone, ExternalLink,
  Sigma, BarChart2,
} from 'lucide-react';
import { Collection, CollectionProperty } from '../../types/collection';
import { evaluateFormula, buildPropsByName, computeRollup } from '../../lib/formula';

interface TableViewProps {
    collection: Collection;
    data: any[];
    onAddRow: () => void;
    onEditCell: (rowId: string, propertyId: string, value: any) => void;
    onOpenRow?: (id: string) => void;
    /** Pre-fetched items from related collections. Key = targetCollectionId */
    relatedItems?: Map<string, any[]>;
}

const PropertyIcon = ({ type }: { type: CollectionProperty['type'] }) => {
    switch (type) {
        case 'text':         return <Type size={14} />;
        case 'number':       return <Hash size={14} />;
        case 'date':         return <Calendar size={14} />;
        case 'checkbox':     return <CheckSquare size={14} />;
        case 'url':          return <Link size={14} />;
        case 'email':        return <Mail size={14} />;
        case 'phone':        return <Phone size={14} />;
        case 'formula':      return <Sigma size={14} />;
        case 'relation':     return <ExternalLink size={14} />;
        case 'rollup':       return <BarChart2 size={14} />;
        default:             return <Type size={14} />;
    }
};

// ── Relation cell ─────────────────────────────────────────────────────────────

function RelationCell({
    value,
    targetCollectionId,
    relatedItems,
    onChange,
}: {
    value: string[];
    targetCollectionId: string;
    relatedItems: Map<string, any[]>;
    onChange: (val: string[]) => void;
}) {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const items = relatedItems.get(targetCollectionId) ?? [];
    const selectedIds: string[] = Array.isArray(value) ? value : [];

    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        if (open) document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [open]);

    const toggle = (id: string) => {
        const next = selectedIds.includes(id) ? selectedIds.filter(x => x !== id) : [...selectedIds, id];
        onChange(next);
    };

    return (
        <div ref={ref} className="relative">
            {/* Chips display */}
            <div
                className="flex flex-wrap gap-1 min-h-[1.5em] cursor-pointer"
                onClick={() => setOpen(o => !o)}
            >
                {selectedIds.length === 0 && (
                    <span className="text-gray-200 text-xs py-0.5">點擊連結...</span>
                )}
                {selectedIds.map(id => {
                    const item = items.find(i => i.id === id);
                    return item ? (
                        <span
                            key={id}
                            className="inline-flex items-center px-1.5 py-0.5 rounded text-xs font-medium"
                            style={{ background: 'var(--color-accent-light)', color: 'var(--color-accent)' }}
                        >
                            {item.title || '無標題'}
                        </span>
                    ) : null;
                })}
            </div>

            {/* Picker dropdown */}
            <AnimatePresence>
                {open && (
                    <motion.div
                        initial={{ opacity: 0, y: -4 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -4 }}
                        transition={{ duration: 0.1 }}
                        className="absolute z-30 left-0 py-1 rounded-xl overflow-hidden"
                        style={{
                            top: '100%', marginTop: 4, minWidth: 200, maxHeight: 220, overflowY: 'auto',
                            background: 'var(--color-surface)', border: '1px solid var(--color-border)',
                            boxShadow: 'var(--shadow-lg)',
                        }}
                    >
                        {items.length === 0 && (
                            <p className="px-3 py-2 text-xs" style={{ color: 'var(--color-text-quaternary)' }}>
                                目標資料庫無資料
                            </p>
                        )}
                        {items.map(item => {
                            const selected = selectedIds.includes(item.id);
                            return (
                                <button
                                    key={item.id}
                                    onMouseDown={e => { e.preventDefault(); toggle(item.id); }}
                                    className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors"
                                    style={{ background: selected ? 'var(--color-accent-light)' : 'transparent', color: selected ? 'var(--color-accent)' : 'var(--color-text-primary)' }}
                                    onMouseEnter={e => { if (!selected) e.currentTarget.style.background = 'var(--color-surface-secondary)'; }}
                                    onMouseLeave={e => { if (!selected) e.currentTarget.style.background = 'transparent'; }}
                                >
                                    <span className="w-3 h-3 rounded border flex-shrink-0 flex items-center justify-center"
                                        style={{ borderColor: selected ? 'var(--color-accent)' : 'var(--color-border)', background: selected ? 'var(--color-accent)' : 'transparent' }}
                                    >
                                        {selected && <span className="text-white" style={{ fontSize: 8, lineHeight: 1 }}>✓</span>}
                                    </span>
                                    {item.title || '無標題'}
                                </button>
                            );
                        })}
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    );
}

// ── Editable cell (basic types) ───────────────────────────────────────────────

function EditableCell({ value, type, onChange }: { value: any; type: CollectionProperty['type']; onChange: (val: any) => void }) {
    const [editing, setEditing] = React.useState(false);
    const [tempValue, setTempValue] = React.useState(value);

    const handleBlur = () => {
        setEditing(false);
        if (tempValue !== value) onChange(tempValue);
    };

    if (type === 'checkbox') {
        return (
            <input
                type="checkbox"
                checked={!!value}
                onChange={e => onChange(e.target.checked)}
                className="w-4 h-4 accent-accent rounded"
            />
        );
    }

    if (editing) {
        return (
            <input
                autoFocus
                value={tempValue || ''}
                onChange={e => setTempValue(e.target.value)}
                onBlur={handleBlur}
                onKeyDown={e => e.key === 'Enter' && handleBlur()}
                className="w-full bg-white border border-accent rounded px-1 -mx-1 outline-none shadow-sm"
            />
        );
    }

    return (
        <div
            onClick={() => setEditing(true)}
            className="w-full min-h-[1.5em] py-0.5 cursor-text text-gray-700 truncate"
        >
            {value || ''}
            {!value && <span className="text-gray-200">無內容</span>}
        </div>
    );
}

// ── ReadOnly display (formula / rollup) ───────────────────────────────────────

function ReadOnlyCell({ value }: { value: string | number | boolean }) {
    const display = value === '' ? '—' : String(value);
    const isErr = display === '#ERR';
    return (
        <div
            className="w-full min-h-[1.5em] py-0.5 truncate select-none"
            style={{ color: isErr ? '#ef4444' : '#6b7280', fontStyle: 'italic', fontSize: 13 }}
            title={isErr ? '公式錯誤，請檢查表達式' : display}
        >
            {display}
        </div>
    );
}

// ── TableView ─────────────────────────────────────────────────────────────────

export function TableView({ collection, data, onAddRow, onEditCell, onOpenRow, relatedItems = new Map() }: TableViewProps) {
    const properties = Object.entries(collection.schema.properties);
    const schema = collection.schema.properties;

    return (
        <div className="flex flex-col h-full bg-white">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-2 border-b border-gray-100">
                <div className="flex items-center gap-2">
                    <div className="relative">
                        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" size={14} />
                        <input
                            type="text"
                            placeholder="搜尋..."
                            className="pl-8 pr-3 py-1.5 rounded-lg bg-gray-50 border-none text-sm outline-none focus:ring-2 focus:ring-accent/20 transition-all w-48"
                        />
                    </div>
                    <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors text-sm">
                        <Filter size={14} /> 篩選
                    </button>
                    <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors text-sm">
                        <ArrowUpDown size={14} /> 排序
                    </button>
                </div>
                <button onClick={onAddRow} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors text-sm font-medium shadow-sm">
                    <Plus size={14} /> 新增一行
                </button>
            </div>

            {/* Table */}
            <div className="flex-1 overflow-auto">
                <table className="w-full border-collapse text-sm table-fixed min-w-[800px]">
                    <thead className="sticky top-0 z-10 bg-white shadow-[0_1px_0_0_rgba(0,0,0,0.05)]">
                        <tr>
                            <th className="w-12 px-4 py-3 text-left border-b border-r border-gray-100 bg-gray-50/50">
                                <div className="w-4 h-4 rounded border border-gray-300" />
                            </th>
                            {properties.map(([id, prop]) => (
                                <th key={id} className="px-4 py-3 text-left border-b border-r border-gray-100 bg-gray-50/50 group">
                                    <div className="flex items-center gap-2 text-gray-500 font-medium">
                                        <PropertyIcon type={prop.type} />
                                        <span className="truncate">{prop.name}</span>
                                        {(prop.type === 'formula' || prop.type === 'rollup') && (
                                            <span className="ml-1 text-gray-300 text-xs font-normal">計算</span>
                                        )}
                                        <button className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
                                            <MoreHorizontal size={14} />
                                        </button>
                                    </div>
                                </th>
                            ))}
                            <th className="w-full border-b border-gray-100 bg-gray-50/50" />
                        </tr>
                    </thead>
                    <tbody>
                        {data.map((row, idx) => {
                            const rowProps: Record<string, any> = row.properties ?? {};
                            // Build propsByName map for formula evaluation
                            const propsByName = buildPropsByName(schema, rowProps);

                            return (
                                <motion.tr
                                    key={row.id || idx}
                                    initial={{ opacity: 0, y: 4 }}
                                    animate={{ opacity: 1, y: 0 }}
                                    transition={{ delay: idx * 0.03 }}
                                    className="group hover:bg-gray-50/80 transition-colors"
                                >
                                    <td className="px-4 py-2.5 border-b border-r border-gray-100 text-center">
                                        <span className="text-gray-400 group-hover:hidden">{idx + 1}</span>
                                        <div className="hidden group-hover:flex items-center justify-center gap-1">
                                            <div className="w-4 h-4 rounded border border-gray-300" />
                                            {onOpenRow && (
                                                <button onClick={() => onOpenRow(row.id)} className="text-gray-400 hover:text-accent transition-colors" title="開啟詳情">
                                                    <ExternalLink size={12} />
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                    {properties.map(([id, prop]) => {
                                        // ── Formula: computed, read-only ─────────────────
                                        if (prop.type === 'formula') {
                                            const computed = evaluateFormula(prop.formula ?? '', propsByName);
                                            return (
                                                <td key={id} className="px-4 py-2.5 border-b border-r border-gray-100 align-top">
                                                    <ReadOnlyCell value={computed} />
                                                </td>
                                            );
                                        }

                                        // ── Rollup: aggregate from related items ─────────
                                        if (prop.type === 'rollup' && prop.rollup) {
                                            const relPropId = prop.rollup.relationPropId;
                                            const relProp = schema[relPropId];
                                            const targetColId = relProp?.relation?.targetCollectionId ?? '';
                                            const targetItems = relatedItems.get(targetColId) ?? [];
                                            const computed = computeRollup(prop.rollup, rowProps, targetItems);
                                            return (
                                                <td key={id} className="px-4 py-2.5 border-b border-r border-gray-100 align-top">
                                                    <ReadOnlyCell value={computed} />
                                                </td>
                                            );
                                        }

                                        // ── Relation: chip picker ────────────────────────
                                        if (prop.type === 'relation' && prop.relation?.targetCollectionId) {
                                            return (
                                                <td key={id} className="px-4 py-2.5 border-b border-r border-gray-100 align-top">
                                                    <RelationCell
                                                        value={rowProps[id]}
                                                        targetCollectionId={prop.relation.targetCollectionId}
                                                        relatedItems={relatedItems}
                                                        onChange={val => onEditCell(row.id, id, val)}
                                                    />
                                                </td>
                                            );
                                        }

                                        // ── Basic editable cell ─────────────────────────
                                        return (
                                            <td key={id} className="px-4 py-2.5 border-b border-r border-gray-100 align-top">
                                                <EditableCell
                                                    value={rowProps[id]}
                                                    type={prop.type}
                                                    onChange={val => onEditCell(row.id, id, val)}
                                                />
                                            </td>
                                        );
                                    })}
                                    <td className="border-b border-gray-100" />
                                </motion.tr>
                            );
                        })}
                        <tr className="hover:bg-gray-50/50 cursor-pointer transition-colors" onClick={onAddRow}>
                            <td className="px-4 py-3 border-b border-r border-gray-100 text-center">
                                <Plus size={14} className="text-gray-400 mx-auto" />
                            </td>
                            <td colSpan={properties.length} className="px-4 py-3 border-b border-gray-100 text-gray-400">
                                新增一行...
                            </td>
                            <td className="border-b border-gray-100" />
                        </tr>
                    </tbody>
                </table>
            </div>
        </div>
    );
}

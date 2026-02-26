import React from 'react';
import { motion } from 'motion/react';
import { Plus, Search, Filter, ArrowUpDown, MoreHorizontal, Hash, Type, Calendar, CheckSquare, Link, Mail, Phone } from 'lucide-react';
import { Collection, CollectionProperty } from '../../types/collection';

interface TableViewProps {
    collection: Collection;
    data: any[];
    onAddRow: () => void;
    onEditCell: (rowId: string, propertyId: string, value: any) => void;
}

const PropertyIcon = ({ type }: { type: CollectionProperty['type'] }) => {
    switch (type) {
        case 'text': return <Type size={14} />;
        case 'number': return <Hash size={14} />;
        case 'date': return <Calendar size={14} />;
        case 'checkbox': return <CheckSquare size={14} />;
        case 'url': return <Link size={14} />;
        case 'email': return <Mail size={14} />;
        case 'phone': return <Phone size={14} />;
        default: return <Type size={14} />;
    }
};

export function TableView({ collection, data, onAddRow, onEditCell }: TableViewProps) {
    const properties = Object.entries(collection.schema.properties);

    return (
        <div className="flex flex-col h-full bg-white">
            {/* Table Toolbar */}
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
                        <Filter size={14} />
                        篩選
                    </button>
                    <button className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors text-sm">
                        <ArrowUpDown size={14} />
                        排序
                    </button>
                </div>
                <button
                    onClick={onAddRow}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-accent text-white hover:bg-accent/90 transition-colors text-sm font-medium shadow-sm"
                >
                    <Plus size={14} />
                    新增一行
                </button>
            </div>

            {/* Table Container */}
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
                        {data.map((row, idx) => (
                            <motion.tr
                                key={row.id || idx}
                                initial={{ opacity: 0, y: 4 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: idx * 0.03 }}
                                className="group hover:bg-gray-50/80 transition-colors"
                            >
                                <td className="px-4 py-2.5 border-b border-r border-gray-100 text-center">
                                    <span className="text-gray-400 group-hover:hidden">{idx + 1}</span>
                                    <div className="hidden group-hover:block mx-auto w-4 h-4 rounded border border-gray-300" />
                                </td>
                                {properties.map(([id, prop]) => (
                                    <td key={id} className="px-4 py-2.5 border-b border-r border-gray-100 align-top">
                                        <EditableCell
                                            value={row.properties?.[id]}
                                            type={prop.type}
                                            onChange={(val) => onEditCell(row.id, id, val)}
                                        />
                                    </td>
                                ))}
                                <td className="border-b border-gray-100" />
                            </motion.tr>
                        ))}
                        {/* Empty space for adding more */}
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

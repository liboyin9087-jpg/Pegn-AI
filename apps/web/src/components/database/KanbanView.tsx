import React from 'react';
import { motion } from 'motion/react';
import { Plus, MoreHorizontal, User, Calendar, MessageSquare } from 'lucide-react';
import { Collection } from '../../types/collection';

interface KanbanViewProps {
    collection: Collection;
    data: any[];
    groupBy?: string;
}

export function KanbanView({ collection, data, groupBy = 'status' }: KanbanViewProps) {
    // Mocking groups if no real data/schema options yet
    const groupOptions = [
        { label: '未開始', value: 'todo', color: '#e2e8f0' },
        { label: '進行中', value: 'in-progress', color: '#dbeafe' },
        { label: '已完成', value: 'done', color: '#dcfce7' },
    ];

    const groupedData = groupOptions.map(group => ({
        ...group,
        items: data.filter(item => (item.properties?.[groupBy] || 'todo') === group.value)
    }));

    return (
        <div className="flex h-full bg-gray-50/50 p-6 gap-6 overflow-x-auto">
            {groupedData.map((group, gIdx) => (
                <div key={group.value} className="flex-shrink-0 w-80 flex flex-col group/column">
                    {/* Column Header */}
                    <div className="flex items-center justify-between mb-3 px-1">
                        <div className="flex items-center gap-2">
                            <span
                                className="px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider"
                                style={{ background: group.color, color: 'rgba(0,0,0,0.6)' }}
                            >
                                {group.label}
                            </span>
                            <span className="text-gray-400 text-xs font-medium">{group.items.length}</span>
                        </div>
                        <div className="flex items-center gap-1 opacity-0 group-hover/column:opacity-100 transition-opacity">
                            <button className="p-1 hover:bg-gray-200 rounded transition-colors text-gray-500">
                                <Plus size={14} />
                            </button>
                            <button className="p-1 hover:bg-gray-200 rounded transition-colors text-gray-500">
                                <MoreHorizontal size={14} />
                            </button>
                        </div>
                    </div>

                    {/* Cards List */}
                    <div className="flex-1 flex flex-col gap-3 min-h-[100px]">
                        {group.items.length === 0 ? (
                            <div className="border-2 border-dashed border-gray-200 rounded-xl p-8 flex flex-col items-center justify-center text-gray-300">
                                <Plus size={24} className="mb-2 opacity-50" />
                                <span className="text-xs">尚無項目</span>
                            </div>
                        ) : (
                            group.items.map((item, iIdx) => (
                                <KanbanCard key={item.id || iIdx} item={item} />
                            ))
                        )}

                        <button className="mt-1 flex items-center gap-2 px-3 py-2 text-gray-400 hover:text-gray-600 hover:bg-gray-200/50 rounded-lg transition-all text-sm w-full">
                            <Plus size={14} />
                            新增項目
                        </button>
                    </div>
                </div>
            ))}

            {/* Add Column button */}
            <div className="flex-shrink-0 w-80">
                <button className="w-full py-3 border-2 border-dashed border-gray-200 rounded-xl text-gray-400 hover:text-gray-600 hover:border-gray-300 hover:bg-white transition-all text-sm font-medium flex items-center justify-center gap-2">
                    <Plus size={16} />
                    新增分組
                </button>
            </div>
        </div>
    );
}

function KanbanCard({ item }: { item: any }) {
    return (
        <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ y: -2, boxShadow: '0 12px 24px -10px rgba(0,0,0,0.1)' }}
            className="bg-white p-4 rounded-xl border border-gray-100 shadow-sm cursor-grab active:cursor-grabbing transition-shadow"
        >
            <h4 className="text-sm font-semibold text-gray-800 mb-3 line-clamp-2">
                {item.properties?.title || item.name || '無標題項目'}
            </h4>

            {/* Tags / Badges */}
            <div className="flex flex-wrap gap-1.5 mb-4">
                {item.properties?.tags?.map((tag: string, idx: number) => (
                    <span key={idx} className="px-2 py-0.5 rounded-full bg-gray-100 text-[10px] font-medium text-gray-600">
                        {tag}
                    </span>
                ))}
            </div>

            {/* Footer Info */}
            <div className="flex items-center justify-between pt-3 border-t border-gray-50">
                <div className="flex -space-x-2">
                    <div className="w-6 h-6 rounded-full bg-accent border-2 border-white flex items-center justify-center text-[10px] text-white font-bold">
                        A
                    </div>
                    <div className="w-6 h-6 rounded-full bg-purple-500 border-2 border-white flex items-center justify-center text-[10px] text-white font-bold">
                        B
                    </div>
                </div>

                <div className="flex items-center gap-3 text-gray-400">
                    <div className="flex items-center gap-1">
                        <MessageSquare size={12} />
                        <span className="text-[10px]">2</span>
                    </div>
                    <div className="flex items-center gap-1">
                        <Calendar size={12} />
                        <span className="text-[10px]">3月10日</span>
                    </div>
                </div>
            </div>
        </motion.div>
    );
}

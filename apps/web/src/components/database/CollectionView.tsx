import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Layout, Table as TableIcon, Columns, Calendar as CalendarIcon, GalleryVertical, List as ListIcon, Settings2, Download } from 'lucide-react';
import { Collection, CollectionView as ViewType } from '../../types/collection';
import { TableView } from './TableView';
import { KanbanView } from './KanbanView';
import { exportCollection } from '../../api/client';

interface CollectionViewProps {
    collection: Collection;
    views: ViewType[];
    onAddRow: () => void;
    onUpdateView: (viewId: string, updates: any) => void;
}

export function CollectionView({ collection, views, onAddRow, onUpdateView }: CollectionViewProps) {
    const [activeViewId, setActiveViewId] = useState<string | null>(views[0]?.id || null);
    const activeView = views.find(v => v.id === activeViewId) || views[0];

    const handleExport = async () => {
        try {
            const blob = await exportCollection(collection.id, 'csv');
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${collection.name}.csv`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
        } catch (error) {
            console.error('Export failed:', error);
            alert('導出失敗，請重試');
        }
    };

    const ViewIcon = ({ type }: { type: string }) => {
        switch (type) {
            case 'table': return <TableIcon size={14} />;
            case 'board': return <Columns size={14} />;
            case 'calendar': return <CalendarIcon size={14} />;
            case 'gallery': return <GalleryVertical size={14} />;
            case 'list': return <ListIcon size={14} />;
            default: return <TableIcon size={14} />;
        }
    };

    return (
        <div className="flex flex-col h-full overflow-hidden bg-white">
            {/* View Tabs */}
            <div className="flex items-center gap-1 px-4 pt-4 border-b border-gray-100 flex-shrink-0">
                {views.map(view => (
                    <button
                        key={view.id}
                        onClick={() => setActiveViewId(view.id)}
                        className={`
              flex items-center gap-1.5 px-3 py-2 rounded-t-lg text-sm font-medium transition-all relative
              ${activeViewId === view.id ? 'text-accent' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-50'}
            `}
                    >
                        <ViewIcon type={view.type} />
                        {view.name}
                        {activeViewId === view.id && (
                            <motion.div
                                layoutId="activeViewTab"
                                className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent"
                            />
                        )}
                    </button>
                ))}
                <button
                    onClick={handleExport}
                    className="ml-auto mr-1 p-2 text-gray-400 hover:text-accent hover:bg-gray-50 rounded-lg transition-colors title='導出資料'"
                >
                    <Download size={14} />
                </button>
                <button className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-50 rounded-lg transition-colors">
                    <Settings2 size={14} />
                </button>
            </div>

            {/* View Content */}
            <div className="flex-1 overflow-hidden relative">
                <AnimatePresence mode="wait">
                    <motion.div
                        key={activeView?.id || 'empty'}
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -10 }}
                        transition={{ duration: 0.2, ease: "easeOut" }}
                        className="w-full h-full"
                    >
                        {activeView?.type === 'table' ? (
                            <TableView
                                collection={collection}
                                data={[]} // TODO: Fetch documents for this collection
                                onAddRow={onAddRow}
                                onEditCell={() => { }}
                            />
                        ) : activeView?.type === 'board' ? (
                            <KanbanView
                                collection={collection}
                                data={[]} // TODO: Fetch documents for this collection
                            />
                        ) : (
                            <div className="flex flex-col items-center justify-center h-full text-gray-400">
                                <Layout size={48} className="mb-4 opacity-20" />
                                <p>視圖模式「{activeView?.type}」開發中</p>
                                <button
                                    onClick={() => onUpdateView(activeView.id, { type: 'table' })}
                                    className="mt-4 text-accent hover:underline text-sm"
                                >
                                    切換至表格視圖
                                </button>
                            </div>
                        )}
                    </motion.div>
                </AnimatePresence>
            </div>
        </div>
    );
}

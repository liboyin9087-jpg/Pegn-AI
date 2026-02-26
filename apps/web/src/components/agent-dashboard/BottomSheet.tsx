import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Search, Code, Terminal, Clock } from 'lucide-react';

export type BottomSheetTab = 'logs' | 'metadata' | 'history';

interface BottomSheetProps {
    isOpen: boolean;
    onClose: () => void;
    title?: string;
    defaultTab?: BottomSheetTab;
    children: React.ReactNode;
}

export const BottomSheet: React.FC<BottomSheetProps> = ({
    isOpen,
    onClose,
    title,
    defaultTab = 'logs',
    children
}) => {
    const [mounted, setMounted] = useState(false);
    const [snapPoint, setSnapPoint] = useState<'peek' | 'half' | 'full'>('half');
    const [activeTab, setActiveTab] = useState<BottomSheetTab>(defaultTab);

    const sheetRef = useRef<HTMLDivElement>(null);
    const startY = useRef(0);
    const [translateY, setTranslateY] = useState(0);
    const [isDragging, setIsDragging] = useState(false);

    useEffect(() => { setMounted(true); }, []);
    useEffect(() => {
        if (isOpen) {
            document.body.style.overflow = 'hidden';
            setSnapPoint('half');
            setTranslateY(0);
            setActiveTab(defaultTab);
        } else {
            document.body.style.overflow = '';
            setTranslateY(500); // 離開畫面
        }
    }, [isOpen, defaultTab]);

    const handleDragStart = (e: React.TouchEvent | React.MouseEvent) => {
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        startY.current = clientY - translateY;
        setIsDragging(true);
    };

    const handleDragMove = (e: React.TouchEvent | React.MouseEvent) => {
        if (!isDragging) return;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        let newY = clientY - startY.current;

        // 向上拉增加阻尼 (Rubber-banding)
        if (newY < 0 && snapPoint === 'full') {
            newY = newY * 0.2; // 很大阻力
        }

        setTranslateY(newY);
    };

    const handleDragEnd = () => {
        setIsDragging(false);

        // 吸附邏輯
        if (translateY > 100 && snapPoint === 'half') {
            onClose();
        } else if (translateY < -50 && snapPoint === 'half') {
            setSnapPoint('full');
            setTranslateY(0);
        } else if (translateY > 50 && snapPoint === 'full') {
            setSnapPoint('half');
            setTranslateY(0);
        } else if (translateY > 50 && snapPoint === 'peek') {
            onClose();
        } else if (translateY < -50 && snapPoint === 'peek') {
            setSnapPoint('half');
            setTranslateY(0);
        } else {
            // 回到原位
            setTranslateY(0);
        }
    };

    if (!mounted) return null;

    const getHeightClass = () => {
        switch (snapPoint) {
            case 'peek': return 'h-[140px]'; // 加高 Peek 以顯示 Tabs
            case 'full': return 'h-[calc(100vh-56px)]';
            case 'half':
            default: return 'h-[55vh]';
        }
    };

    const sheet = (
        <div
            className={`fixed inset-0 z-50 flex flex-col justify-end ${isOpen ? 'pointer-events-auto' : 'pointer-events-none'}`}
            role="dialog"
            aria-modal="true"
        >
            <div
                className={`absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity duration-300 ${isOpen ? 'opacity-100' : 'opacity-0'}`}
                onClick={onClose}
            />

            <div
                ref={sheetRef}
                className={`
          relative w-full max-w-[448px] mx-auto bg-agent-bg-2 border-t border-agent-border-default
          rounded-t-[16px] flex flex-col shadow-xl origin-bottom
          ${isDragging ? '' : 'transition-all duration-300 cubic-bezier(0.16, 1, 0.3, 1)'}
          ${getHeightClass()}
        `}
                style={{ transform: `translateY(${isOpen ? translateY : 100}%)`, transitionProperty: isDragging ? 'none' : 'transform, height' }}
            >
                <div
                    className="w-full pt-2 pb-2 mb-1 flex flex-col cursor-grab active:cursor-grabbing flex-shrink-0"
                    onTouchStart={handleDragStart}
                    onTouchMove={handleDragMove}
                    onTouchEnd={handleDragEnd}
                    onMouseDown={handleDragStart}
                    onMouseMove={handleDragMove}
                    onMouseUp={handleDragEnd}
                    onMouseLeave={handleDragEnd}
                >
                    <div className="w-8 h-1 bg-white/[0.28] rounded-full mx-auto" />

                    <div className="w-full flex justify-between items-center px-4 mt-3">
                        <h3 className="text-sm font-semibold text-agent-text-primary truncate pr-4">{title || 'View Details'}</h3>
                        <button onClick={onClose} aria-label="Close" className="w-8 h-8 flex items-center justify-center rounded-full bg-agent-bg-3 text-agent-text-secondary hover:text-white flex-shrink-0">
                            <X size={16} />
                        </button>
                    </div>

                    {/* Tab Navigation */}
                    {snapPoint !== 'peek' && (
                        <div className="flex border-b border-agent-border-default px-4 mt-2 mb-1 gap-6">
                            {[
                                { id: 'logs', label: 'Logs', icon: <Terminal size={14} /> },
                                { id: 'metadata', label: 'Inputs Output', icon: <Code size={14} /> },
                                { id: 'history', label: 'History', icon: <Clock size={14} /> }
                            ].map(tab => (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id as BottomSheetTab)}
                                    className={`
                    flex items-center gap-1.5 py-3 text-xs font-semibold relative
                    ${activeTab === tab.id ? 'text-blue-400' : 'text-agent-text-secondary hover:text-agent-text-primary'}
                  `}
                                >
                                    {tab.icon}
                                    {tab.label}
                                    {activeTab === tab.id && (
                                        <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-blue-500 rounded-t-full" />
                                    )}
                                </button>
                            ))}
                        </div>
                    )}
                </div>

                <div className="flex-1 overflow-y-auto px-4 pb-safe-bottom">
                    {children}
                </div>
            </div>
        </div>
    );

    return createPortal(sheet, document.body);
};

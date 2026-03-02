import React, { useRef, useState, useEffect } from 'react';
import { RefreshCw, X, Check } from 'lucide-react';
import { haptic } from './haptics';

interface SwipeActionProps {
    children: React.ReactNode;
    onRetry?: () => void;
    onDismiss?: () => void;
    onApprove?: () => void;
    disabled?: boolean;
}

export const SwipeActionRow: React.FC<SwipeActionProps> = ({
    children,
    onRetry,
    onDismiss,
    onApprove,
    disabled = false
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [translateX, setTranslateX] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const startX = useRef(0);
    const startY = useRef(0);
    const currentX = useRef(0);
    const isVerticalScroll = useRef(false);

    // 閾值常數
    const ACTION_WIDTH = 72; // 每個 action 按鈕的寬度
    const HAPTIC_THRESHOLD = ACTION_WIDTH * 0.8;
    const FULL_SWIPE_THRESHOLD = typeof window !== 'undefined' ? window.innerWidth * 0.6 : 250;
    const SWIPE_LOCK_THRESHOLD = 15; // 行走 15px 後鎖定垂直滾動

    const handleTouchStart = (e: React.TouchEvent | React.MouseEvent) => {
        if (disabled) return;
        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        startX.current = clientX;
        startY.current = clientY;
        isVerticalScroll.current = false;
        setIsDragging(true);
    };

    const handleTouchMove = (e: React.TouchEvent | React.MouseEvent) => {
        if (!isDragging || disabled || isVerticalScroll.current) return;

        const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
        const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;
        const deltaX = clientX - startX.current;
        const deltaY = clientY - startY.current;

        // 滑動方向鎖定
        if (Math.abs(deltaY) > SWIPE_LOCK_THRESHOLD && Math.abs(deltaX) < SWIPE_LOCK_THRESHOLD) {
            isVerticalScroll.current = true;
            setIsDragging(false);
            setTranslateX(0);
            return;
        }

        // 如果滑動距離小於鎖定閾值，不阻止預設行為 (容許原生垂直滾動)
        if (Math.abs(deltaX) > SWIPE_LOCK_THRESHOLD && e.cancelable) {
            // 在 TouchEvent 已經為 passive: false 的條件下才使用 preventDefault
            // e.preventDefault();
        }

        // 限制左右拉動的最大距離
        let maxLeft = 0;
        let maxRight = 0;

        if (onRetry) maxLeft += ACTION_WIDTH;
        if (onDismiss) maxLeft += ACTION_WIDTH;
        if (onApprove) maxRight += ACTION_WIDTH;

        // 增加阻力效果 與 Full-Swipe 判斷
        let newTranslate = deltaX;
        if (deltaX < -maxLeft) {
            // 如果支援了 Full Swipe (假設 onDismiss 是底色，這裡不實作 fullswipe，只加阻力)
            newTranslate = -maxLeft - Math.pow(Math.abs(deltaX + maxLeft), 0.7);
        } else if (deltaX > maxRight) {
            // 支援右滑 Full Swipe to Approve
            if (onApprove && deltaX > FULL_SWIPE_THRESHOLD) {
                newTranslate = deltaX; // 放開阻力，讓使用者拉到底
            } else {
                newTranslate = maxRight + Math.pow(Math.abs(deltaX - maxRight), 0.7);
            }
        }

        // 觸發 Haptic 反饋
        if (Math.abs(currentX.current) < HAPTIC_THRESHOLD && Math.abs(newTranslate) >= HAPTIC_THRESHOLD) {
            haptic.impact('soft');
        }
        if (onApprove && currentX.current < FULL_SWIPE_THRESHOLD && newTranslate >= FULL_SWIPE_THRESHOLD) {
            haptic.impact('medium'); // 提示已經到達 Full Swipe 閾值
        }

        currentX.current = newTranslate;
        setTranslateX(newTranslate);
    };

    const handleTouchEnd = () => {
        if (!isDragging || disabled || isVerticalScroll.current) return;
        setIsDragging(false);

        let maxLeft = 0;
        let maxRight = 0;
        if (onRetry) maxLeft += ACTION_WIDTH;
        if (onDismiss) maxLeft += ACTION_WIDTH;
        if (onApprove) maxRight += ACTION_WIDTH;

        // 判斷 Full Swipe
        if (onApprove && currentX.current >= FULL_SWIPE_THRESHOLD) {
            setTranslateX(typeof window !== 'undefined' ? window.innerWidth : 400); // 飛出畫面
            setTimeout(() => {
                onApprove();
                setTranslateX(0); // 執行後歸零
            }, 200);
            return;
        }

        // 決定最終 Snap 位置
        let finalTranslate = 0;
        if (currentX.current <= -ACTION_WIDTH * 0.5) {
            finalTranslate = -maxLeft; // 吸附到左側 Swipe Actions (表示往左滑)
        } else if (currentX.current >= ACTION_WIDTH * 0.5) {
            finalTranslate = maxRight; // 吸附到右側 Swipe Actions
        }

        setTranslateX(finalTranslate);
        currentX.current = finalTranslate;
    };

    return (
        <div className="relative w-full overflow-hidden bg-agent-bg-2">
            {/* 隱藏在背後的 Actions (左滑露出的右側 Actions) */}
            <div className="absolute inset-y-0 right-0 flex max-w-[50%]">
                {onRetry && (
                    <button
                        onClick={() => { onRetry(); setTranslateX(0); }}
                        className={`w-[72px] bg-blue-500 text-white flex flex-col items-center justify-center transition-opacity ${translateX < -36 ? 'opacity-100' : 'opacity-0'}`}
                    >
                        <RefreshCw size={18} />
                        <span className="text-[10px] mt-1 font-medium">Retry</span>
                    </button>
                )}
                {onDismiss && (
                    <button
                        onClick={() => { onDismiss(); setTranslateX(0); }}
                        className={`w-[72px] bg-red-500 text-white flex flex-col items-center justify-center transition-opacity ${translateX < -36 ? 'opacity-100' : 'opacity-0'}`}
                    >
                        <X size={20} />
                        <span className="text-[10px] mt-1 font-medium">Dismiss</span>
                    </button>
                )}
            </div>

            {/* 隱藏在背後的 Actions (右滑露出的左側 Actions) */}
            <div className={`absolute inset-y-0 left-0 flex ${translateX > FULL_SWIPE_THRESHOLD ? 'w-full' : 'max-w-[50%]'}`}>
                {onApprove && (
                    <button
                        onClick={() => { onApprove(); setTranslateX(0); }}
                        className={`
              ${translateX > FULL_SWIPE_THRESHOLD ? 'w-full' : 'w-[72px]'}
              bg-green-500 text-white flex flex-col items-center justify-center
              transition-all ${translateX > 36 ? 'opacity-100' : 'opacity-0'}
            `}
                    >
                        <Check size={20} className={translateX > FULL_SWIPE_THRESHOLD ? 'scale-125 transition-transform' : ''} />
                        <span className="text-[10px] mt-1 font-medium">{translateX > FULL_SWIPE_THRESHOLD ? 'Release to Approve' : 'Approve'}</span>
                    </button>
                )}
            </div>

            {/* 滑動表層 */}
            <div
                ref={containerRef}
                className="w-full relative z-10 bg-agent-bg-0"
                style={{
                    transform: `translateX(${translateX}px)`,
                    transition: isDragging ? 'none' : 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)'
                }}
                onTouchStart={handleTouchStart}
                onTouchMove={handleTouchMove}
                onTouchEnd={handleTouchEnd}
                onMouseDown={handleTouchStart}
                onMouseMove={handleTouchMove}
                onMouseUp={handleTouchEnd}
                onMouseLeave={handleTouchEnd}
            >
                {children}
            </div>
        </div>
    );
};

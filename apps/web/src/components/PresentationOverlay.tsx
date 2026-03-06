/**
 * PresentationOverlay — 簡報 / Zen 全螢幕模式
 *
 * 觸發方式：全局鍵盤 P，或從 useAppContext().setPresentationMode(true)
 * 離開方式：Esc、點擊關閉、← → 到達首尾後繼續按方向鍵
 *
 * 內容來源：
 *   - 若 activeCollection 存在 → 顯示 collection 項目清單（每個項目一張投影片）
 *   - 否則若 activeDoc 存在      → 顯示文件標題與內容摘要
 *   - 否則                         → 顯示說明畫面
 */

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, ChevronLeft, ChevronRight, Presentation, LayoutGrid } from 'lucide-react';
import { useAppContext } from '../contexts/AppContext';

// ─── 型別 ────────────────────────────────────────────────────

interface Slide {
  id: string;
  title: string;
  subtitle?: string;
  meta?: string;
  color?: string;
}

// ─── 投影片色票（循環） ───────────────────────────────────────

const PALETTE = [
  '#3b82f6', '#8b5cf6', '#06b6d4', '#10b981',
  '#f59e0b', '#ef4444', '#ec4899', '#6366f1',
];

// ─── 工具函數 ─────────────────────────────────────────────────

function buildSlides(
  activeCollection: any | null,
  activeDoc: any | null,
): Slide[] {
  if (activeCollection) {
    // 用 collection 名稱作首張封面
    const cover: Slide = {
      id: '__cover__',
      title: activeCollection.name ?? '資料庫',
      subtitle: activeCollection.description ?? undefined,
      color: PALETTE[0],
    };
    return [cover];
  }

  if (activeDoc) {
    return [
      {
        id: activeDoc.id,
        title: activeDoc.title ?? '(未命名)',
        subtitle: activeDoc.excerpt ?? activeDoc.content?.slice?.(0, 120) ?? '',
        color: PALETTE[1],
      },
    ];
  }

  return [
    {
      id: '__empty__',
      title: '沒有可展示的內容',
      subtitle: '請先選取一份文件或資料庫後，再進入簡報模式。',
      color: PALETTE[2],
    },
  ];
}

// ─── 元件 ────────────────────────────────────────────────────

export default function PresentationOverlay() {
  const { presentationMode, setPresentationMode, activeCollection, activeDoc } = useAppContext();

  const slides = useMemo(
    () => buildSlides(activeCollection, activeDoc),
    [activeCollection, activeDoc],
  );

  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState<1 | -1>(1);

  // 重置 index 每次開啟
  useEffect(() => {
    if (presentationMode) setIndex(0);
  }, [presentationMode]);

  const go = useCallback(
    (delta: 1 | -1) => {
      setDirection(delta);
      setIndex((prev: number) => Math.max(0, Math.min(slides.length - 1, prev + delta)));
    },
    [slides.length],
  );

  const close = useCallback(() => {
    setPresentationMode(false);
  }, [setPresentationMode]);

  // 鍵盤 ← → Esc
  useEffect(() => {
    if (!presentationMode) return;
    function handle(e: KeyboardEvent) {
      if (e.key === 'Escape') { close(); return; }
      if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); go(1); }
      if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp')   { e.preventDefault(); go(-1); }
    }
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [presentationMode, go, close]);

  const current = slides[index] ?? slides[0];
  const bg = current?.color ?? PALETTE[0];

  return (
    <AnimatePresence>
      {presentationMode && (
        <motion.div
          key="presentation-overlay"
          className="fixed inset-0 z-[60] flex flex-col select-none"
          style={{ background: bg }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
        >
          {/* ── 頂部工具欄 */}
          <div className="flex items-center justify-between px-6 py-4 opacity-0 hover:opacity-100 transition-opacity duration-300 absolute top-0 inset-x-0 z-10">
            <div className="flex items-center gap-2 text-white/80 text-sm">
              <Presentation className="w-4 h-4" />
              <span className="font-medium">簡報模式</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-white/60 text-sm tabular-nums">
                {index + 1} / {slides.length}
              </span>
              <button
                onClick={close}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/20 hover:bg-white/30 text-white text-sm transition-colors"
              >
                <X className="w-3.5 h-3.5" />
                <span>離開</span>
              </button>
            </div>
          </div>

          {/* ── 投影片主體 */}
          <div className="flex-1 flex items-center justify-center px-16 py-16 overflow-hidden relative">
            <AnimatePresence mode="wait" custom={direction}>
              <motion.div
                key={current.id}
                custom={direction}
                variants={{
                  enter: (d: number) => ({ x: d > 0 ? '60%' : '-60%', opacity: 0 }),
                  center: { x: '0%', opacity: 1 },
                  exit: (d: number) => ({ x: d > 0 ? '-60%' : '60%', opacity: 0 }),
                }}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
                className="text-center max-w-3xl w-full"
              >
                {/* 投影片圖示 */}
                <div className="flex justify-center mb-8">
                  <div className="w-16 h-16 rounded-2xl bg-white/20 flex items-center justify-center">
                    <LayoutGrid className="w-8 h-8 text-white" />
                  </div>
                </div>

                {/* 標題 */}
                <h1
                  className="text-4xl md:text-5xl font-bold text-white leading-tight mb-4"
                  style={{ textShadow: '0 2px 16px rgba(0,0,0,0.2)' }}
                >
                  {current.title}
                </h1>

                {/* 副標題 */}
                {current.subtitle && (
                  <p className="text-lg md:text-xl text-white/75 leading-relaxed max-w-xl mx-auto">
                    {current.subtitle}
                  </p>
                )}

                {/* meta */}
                {current.meta && (
                  <p className="mt-4 text-sm text-white/50">{current.meta}</p>
                )}
              </motion.div>
            </AnimatePresence>
          </div>

          {/* ── 底部導航 */}
          <div className="flex items-center justify-center gap-6 pb-8 opacity-0 hover:opacity-100 transition-opacity duration-300 absolute bottom-0 inset-x-0 z-10">
            {/* 上一張 */}
            <button
              onClick={() => go(-1)}
              disabled={index === 0}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white/20 hover:bg-white/30 disabled:opacity-30 text-white text-sm transition-colors"
              aria-label="上一張"
            >
              <ChevronLeft className="w-4 h-4" />
              上一張
            </button>

            {/* 點點導航 */}
            <div className="flex gap-1.5">
              {slides.map((s: Slide, i: number) => (
                <button
                  key={s.id}
                  onClick={() => { setDirection(i > index ? 1 : -1); setIndex(i); }}
                  className="w-2 h-2 rounded-full transition-all"
                  style={{ background: i === index ? 'white' : 'rgba(255,255,255,0.4)' }}
                  aria-label={`第 ${i + 1} 張`}
                />
              ))}
            </div>

            {/* 下一張 */}
            <button
              onClick={() => go(1)}
              disabled={index === slides.length - 1}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-white/20 hover:bg-white/30 disabled:opacity-30 text-white text-sm transition-colors"
              aria-label="下一張"
            >
              下一張
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>

          {/* ── 永遠可見的 Esc 提示 */}
          <div className="absolute bottom-4 right-6 text-white/30 text-xs pointer-events-none">
            按 Esc 離開簡報模式
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

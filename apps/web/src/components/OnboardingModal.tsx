import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowRight, Check, FileText, Sparkles, Users, Upload } from 'lucide-react';

interface Props {
  onComplete: () => void;
  workspaceId?: string;
}

const STEPS = [
  {
    id: 1,
    Icon: FileText,
    title: '建立文件',
    desc: '點擊左側「New」建立第一份文件，在編輯器中直接輸入 Markdown 內容。',
  },
  {
    id: 2,
    Icon: Sparkles,
    title: 'AI 對話',
    desc: '右側 AI 面板根據你的文件知識庫回答問題，附上來源引用，像是你專屬的 AI 研究助理。',
  },
  {
    id: 3,
    Icon: Upload,
    title: '語意搜尋',
    desc: '「Search」面板支援語意搜尋，輸入問題即可找到相關段落，結合向量 + BM25 雙引擎。',
  },
  {
    id: 4,
    Icon: Users,
    title: '準備好了！',
    desc: '你的工作區已就緒。現在可以開始新增文件，或直接和 AI 對話探索功能。',
  },
];

export default function OnboardingModal({ onComplete }: Props) {
  const [step, setStep] = useState(0);
  const current = STEPS[step];
  const isLast = step === STEPS.length - 1;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ background: 'rgba(0,0,0,0.3)', backdropFilter: 'blur(4px)' }}
      onKeyDown={e => { if (e.key === 'Escape') onComplete(); }}
    >
      <div
        className="bg-white rounded-2xl w-full mx-4 overflow-hidden shadow-2xl"
        style={{ maxWidth: 480 }}
        role="dialog"
        aria-modal="true"
      >
        {/* Progress bar */}
        <div className="flex">
          {STEPS.map((_, i) => (
            <div
              key={i}
              className="h-0.5 flex-1 transition-all duration-300"
              style={{ background: i <= step ? '#2383e2' : '#e8e8ea' }}
            />
          ))}
        </div>

        <div className="p-8">
          {/* Step indicators */}
          <div className="flex items-center gap-2 mb-8">
            {STEPS.map((s, i) => (
              <div key={s.id} className="flex items-center gap-2">
                <button
                  onClick={() => setStep(i)}
                  className="w-7 h-7 rounded-full flex items-center justify-center transition-all duration-300 flex-shrink-0"
                  style={{
                    background: i < step ? '#10b981' : i === step ? '#2383e2' : '#f4f5f7',
                    color: i <= step ? 'white' : '#a0a0ae',
                  }}
                >
                  {i < step
                    ? <Check size={14} />
                    : <span style={{ fontSize: 12, fontWeight: 500 }}>{i + 1}</span>
                  }
                </button>
                {i < STEPS.length - 1 && (
                  <div
                    className="w-8 h-0.5 rounded"
                    style={{ background: i < step ? '#10b981' : '#e8e8ea', transition: 'all 0.3s' }}
                  />
                )}
              </div>
            ))}
          </div>

          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.22, ease: 'easeOut' }}
            >
              {/* Icon */}
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center mb-6"
                style={{ background: '#ebf2fc' }}
              >
                <current.Icon size={26} style={{ color: '#2383e2' }} />
              </div>

              <h2 style={{ fontSize: 22, fontWeight: 700, color: '#1a1a2e', letterSpacing: '-0.4px', marginBottom: 8 }}>
                {current.title}
              </h2>
              <p style={{ fontSize: 14, color: '#6b6b7a', lineHeight: 1.65, marginBottom: 24 }}>
                {current.desc}
              </p>

              {/* Final step checkmark */}
              {isLast && (
                <motion.div
                  initial={{ scale: 0.8, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  className="flex justify-center py-4"
                >
                  <div
                    className="w-16 h-16 rounded-full flex items-center justify-center"
                    style={{ background: 'rgba(16,185,129,0.1)' }}
                  >
                    <Check size={32} style={{ color: '#10b981' }} strokeWidth={2.5} />
                  </div>
                </motion.div>
              )}
            </motion.div>
          </AnimatePresence>

          {/* Buttons */}
          <div className="flex gap-3 mt-6">
            {step > 0 && (
              <button
                onClick={() => setStep(s => s - 1)}
                className="flex-1 py-2.5 border rounded-xl text-sm transition-colors"
                style={{ borderColor: '#e8e8ea', color: '#6b6b7a', background: 'white' }}
                onMouseEnter={e => (e.currentTarget.style.background = '#f7f7f8')}
                onMouseLeave={e => (e.currentTarget.style.background = 'white')}
              >
                上一步
              </button>
            )}
            <button
              onClick={isLast ? onComplete : () => setStep(s => s + 1)}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-xl text-white transition-opacity"
              style={{ fontSize: 14, fontWeight: 500, background: '#2383e2' }}
              onMouseEnter={e => (e.currentTarget.style.opacity = '0.9')}
              onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
            >
              {isLast ? '開始使用' : '繼續'}
              <ArrowRight size={15} />
            </button>
          </div>

          <button
            onClick={onComplete}
            className="w-full mt-3 text-xs text-center transition-colors"
            style={{ color: '#a0a0ae' }}
            onMouseEnter={e => (e.currentTarget.style.color = '#6b6b7a')}
            onMouseLeave={e => (e.currentTarget.style.color = '#a0a0ae')}
          >
            跳過教學
          </button>
        </div>
      </div>
    </div>
  );
}

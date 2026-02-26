import React, { useState, useRef, useCallback } from 'react';
import { startResearchAgent, startSummarizeAgent, getToken, api } from '../api/client';

const STATUS_COLOR: Record<string, string> = {
  pending: 'text-text-tertiary',
  running: 'text-warning',
  done: 'text-success',
  error: 'text-error',
};
const STATUS_ICON: Record<string, string> = {
  pending: '○', running: '◌', done: '✓', error: '✗',
};

type AgentMode = 'research' | 'summarize' | 'brainstorm' | 'outline';

const MODE_CONFIG: Record<AgentMode, { icon: string; label: string; placeholder: string; desc: string }> = {
  research:   { icon: '🔬', label: 'Research',   placeholder: '輸入研究問題或主題...',    desc: '深度研究並整合知識庫資料' },
  summarize:  { icon: '📝', label: 'Summarize',  placeholder: '輸入要摘要的文字或主題...', desc: '智慧摘要，提取重點' },
  brainstorm: { icon: '💡', label: 'Brainstorm', placeholder: '輸入要發想的主題...',       desc: '腦力激盪，生成創意想法' },
  outline:    { icon: '📋', label: 'Outline',    placeholder: '輸入要生成大綱的主題...',   desc: '自動生成結構化大綱' },
};

interface Step {
  name: string;
  status: 'pending' | 'running' | 'done' | 'error';
  output?: string;
}

interface RunState {
  id: string;
  status: 'running' | 'done' | 'error';
  steps: Step[];
  type: AgentMode;
  result?: { answer?: string };
}

export default function AgentPanel({
  workspaceId,
  activeDoc,
}: {
  workspaceId: string;
  activeDoc: any;
}) {
  const [mode, setMode] = useState<AgentMode>('research');
  const [input, setInput] = useState('');
  const [run, setRun] = useState<RunState | null>(null);
  const [loading, setLoading] = useState(false);
  const [saved, setSaved] = useState(false);
  const [streamingAnswer, setStreamingAnswer] = useState('');
  const abortRef = useRef<(() => void) | null>(null);
  const streamIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const handleStart = useCallback(async () => {
    if (!input.trim() || !workspaceId || loading) return;
    setLoading(true);
    setSaved(false);
    setRun(null);
    setStreamingAnswer('');

    // Abort previous SSE
    abortRef.current?.();
    if (streamIntervalRef.current) clearInterval(streamIntervalRef.current);

    try {
      // Start the agent job
      let res: any;
      if (mode === 'research') {
        res = await startResearchAgent(input, workspaceId);
      } else {
        // summarize/brainstorm/outline use summarize endpoint for now
        res = await startSummarizeAgent(input, workspaceId);
      }

      const runId = res.run_id;
      setRun({ id: runId, status: 'running', steps: [], type: mode });

      // Connect via SSE for real-time updates
      const token = getToken();
      const url = `http://localhost:4000/api/v1/agents/runs/${runId}/stream${token ? `?token=${token}` : ''}`;
      const es = new EventSource(url);

      abortRef.current = () => es.close();

      es.onmessage = (e) => {
        try {
          const data = JSON.parse(e.data);

          if (data.type === 'step') {
            setRun(prev => {
              if (!prev) return prev;
              const existingIdx = prev.steps.findIndex(s => s.name === data.step.name);
              const newSteps = [...prev.steps];
              if (existingIdx >= 0) {
                newSteps[existingIdx] = data.step;
              } else {
                newSteps.push(data.step);
              }
              return { ...prev, steps: newSteps };
            });
          } else if (data.type === 'run') {
            const completedRun = data.run;
            setRun(completedRun);

            // Simulate streaming for the final answer display
            const answer = completedRun.result?.answer;
            if (answer) {
              setStreamingAnswer('');
              let i = 0;
              streamIntervalRef.current = setInterval(() => {
                i += 4;
                setStreamingAnswer(answer.slice(0, i));
                if (i >= answer.length) {
                  clearInterval(streamIntervalRef.current!);
                  setStreamingAnswer(answer);
                }
              }, 12);
            }
          }
        } catch {}
      };

      es.addEventListener('done', () => {
        es.close();
        setLoading(false);
        abortRef.current = null;
      });

      es.onerror = () => {
        es.close();
        setLoading(false);
        abortRef.current = null;
      };

    } catch (err) {
      setLoading(false);
    }
  }, [input, workspaceId, loading, mode]);

  const handleStop = () => {
    abortRef.current?.();
    abortRef.current = null;
    if (streamIntervalRef.current) clearInterval(streamIntervalRef.current);
    setLoading(false);
    setRun(prev => prev ? { ...prev, status: 'error' } : null);
  };

  const handleSaveToDoc = async () => {
    const answer = run?.result?.answer || streamingAnswer;
    if (!answer || !workspaceId) return;
    const cfg = MODE_CONFIG[mode];
    const title = `${cfg.icon} ${cfg.label}：${input.slice(0, 30)}`;
    try {
      await api(`/documents`, {
        method: 'POST',
        body: JSON.stringify({
          workspace_id: workspaceId,
          title,
          content: { text: answer },
        }),
      });
      setSaved(true);
    } catch { alert('儲存失敗'); }
  };

  const handleUseDoc = () => {
    if (activeDoc) {
      setInput(activeDoc.title || '');
    }
  };

  const finalAnswer = run?.result?.answer || (streamingAnswer.length > 0 ? streamingAnswer : undefined);
  const isAnimating = streamingAnswer.length > 0 && streamingAnswer !== run?.result?.answer;

  return (
    <div className="flex flex-col h-full p-3 gap-3 bg-surface">
      {/* 模式選擇 */}
      <div className="grid grid-cols-4 gap-1 bg-surface-tertiary rounded-xl p-1 border border-border">
        {(Object.entries(MODE_CONFIG) as [AgentMode, typeof MODE_CONFIG[AgentMode]][]).map(([m, cfg]) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            title={cfg.desc}
            className={`py-1.5 text-xs rounded-lg transition-all flex flex-col items-center gap-0.5 ${
              mode === m ? 'bg-accent text-white shadow-sm' : 'text-text-tertiary hover:text-text-primary hover:bg-surface'
            }`}
          >
            <span className="text-sm">{cfg.icon}</span>
            <span className="text-[10px] leading-tight">{cfg.label}</span>
          </button>
        ))}
      </div>

      {/* 當前模式說明 */}
      <p className="text-xs text-text-tertiary -mt-1 px-1">{MODE_CONFIG[mode].desc}</p>

      {/* 輸入 */}
      <div className="space-y-2">
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={MODE_CONFIG[mode].placeholder}
          rows={3}
          className="w-full bg-surface border border-border rounded-xl px-3 py-2 text-sm text-text-primary placeholder-text-tertiary outline-none focus:ring-2 focus:ring-accent resize-none"
          onKeyDown={e => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleStart();
          }}
        />
        <div className="flex gap-2 items-center">
          {activeDoc && (
            <button
              onClick={handleUseDoc}
              className="text-xs text-text-tertiary hover:text-accent transition-colors underline underline-offset-2 truncate max-w-[120px]"
              title={`使用「${activeDoc.title}」作為輸入`}
            >
              使用「{activeDoc.title?.slice(0, 12)}...」
            </button>
          )}
          <div className="flex-1" />
          <span className="text-xs text-text-tertiary">⌘Enter</span>
          {loading ? (
            <button
              onClick={handleStop}
              className="px-3 py-1.5 bg-error-light hover:bg-error/10 border border-error/20 rounded-lg text-error text-xs transition-colors"
            >⏹ 停止</button>
          ) : (
            <button
              onClick={handleStart}
              disabled={!input.trim()}
              className="px-4 py-1.5 bg-accent hover:bg-accent-hover rounded-lg text-white text-sm disabled:opacity-40 transition-colors"
            >▶ 執行</button>
          )}
        </div>
      </div>

      {/* 執行進度 */}
      {run && (
        <div className="flex-1 overflow-y-auto space-y-2 min-h-0">
          {/* Run header */}
          <div className="flex items-center justify-between px-1">
            <span className="text-xs text-text-tertiary font-mono">#{run.id?.slice(0, 8)}</span>
            <div className="flex items-center gap-1.5">
              {loading && (
                <div className="w-3 h-3 border border-warning border-t-transparent rounded-full animate-spin" />
              )}
              <span className={`text-xs font-medium ${STATUS_COLOR[run.status]}`}>
                {run.status === 'running' ? '執行中...' : run.status === 'done' ? '✓ 完成' : '✗ 錯誤'}
              </span>
            </div>
          </div>

          {/* Steps */}
          {run.steps.map((step, i) => (
            <div key={i} className="bg-panel border border-border rounded-xl p-3">
              <div className="flex items-center gap-2">
                {step.status === 'running' ? (
                  <div className="w-3 h-3 border border-warning border-t-transparent rounded-full animate-spin flex-shrink-0" />
                ) : (
                  <span className={`text-sm font-mono flex-shrink-0 ${STATUS_COLOR[step.status]}`}>
                    {STATUS_ICON[step.status]}
                  </span>
                )}
                <span className="text-xs text-text-secondary flex-1">{step.name}</span>
              </div>
              {step.status === 'done' && step.output && (
                <p className="text-xs text-text-tertiary mt-1.5 line-clamp-2 pl-5">
                  {typeof step.output === 'string' ? step.output : JSON.stringify(step.output).slice(0, 120)}
                </p>
              )}
            </div>
          ))}

          {/* Final Answer with streaming effect */}
          {finalAnswer && (
            <div className="bg-accent-light border border-accent-muted rounded-xl p-3">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-medium text-accent">
                  {MODE_CONFIG[run.type]?.icon} 最終結果
                </p>
                <button
                  onClick={handleSaveToDoc}
                  disabled={saved || isAnimating}
                  className="text-xs px-2 py-0.5 bg-accent-muted hover:bg-accent-light text-accent rounded-lg disabled:opacity-40 transition-colors"
                >
                  {saved ? '✓ 已儲存' : '💾 存為文件'}
                </button>
              </div>
              <p className="text-xs text-text-secondary whitespace-pre-wrap leading-relaxed">
                {finalAnswer}
                {isAnimating && (
                  <span className="inline-block w-0.5 h-3.5 bg-accent animate-pulse ml-0.5 align-middle" />
                )}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {!run && !loading && (
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center text-text-tertiary">
            <div className="text-3xl mb-2">🤖</div>
            <p className="text-xs">選擇模式並輸入任務</p>
            <p className="text-xs mt-1 text-text-secondary">⌘Enter 快速執行</p>
            <div className="grid grid-cols-2 gap-2 mt-3 text-left">
              {Object.entries(MODE_CONFIG).map(([m, cfg]) => (
                <button
                  key={m}
                  onClick={() => setMode(m as AgentMode)}
                  className="text-xs p-2 bg-panel hover:bg-surface-tertiary border border-border rounded-lg text-text-tertiary hover:text-text-primary transition-colors text-left"
                >
                  <div className="text-sm mb-0.5">{cfg.icon}</div>
                  <div className="font-medium text-text-secondary">{cfg.label}</div>
                  <div className="text-text-tertiary text-[10px] mt-0.5 leading-tight">{cfg.desc}</div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

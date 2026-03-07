import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  createAgentRun,
  getAgentRun,
  streamAgentRun,
  type AgentRun,
  type AgentRunStep,
  type WorkspaceMembershipSummary,
} from '../api/client';
import AgentRunHistory from './AgentRunHistory';
import { useOptionalAppContext } from '../contexts/AppContext';
import ForbiddenState from './ForbiddenState';

const STATUS_COPY: Record<AgentRun['status'], string> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
};

const STATUS_COLOR: Record<AgentRun['status'], string> = {
  queued: 'text-text-tertiary',
  running: 'text-warning',
  completed: 'text-success',
  failed: 'text-error',
};

type AgentMode = 'research' | 'summarize' | 'brainstorm' | 'outline';

const MODE_CONFIG: Record<AgentMode, { icon: string; label: string; placeholder: string; desc: string; template: string; mode: 'auto' | 'hybrid' | 'graph' }> = {
  research: {
    icon: 'R',
    label: 'Research',
    placeholder: 'Ask the agent to investigate a topic...',
    desc: 'Grounded research with retrieval and synthesis.',
    template: 'research',
    mode: 'auto',
  },
  summarize: {
    icon: 'S',
    label: 'Summarize',
    placeholder: 'Paste text or describe what to summarize...',
    desc: 'Condense content into a concise summary.',
    template: 'summarize',
    mode: 'hybrid',
  },
  brainstorm: {
    icon: 'B',
    label: 'Brainstorm',
    placeholder: 'Describe the problem or topic to ideate...',
    desc: 'Generate options, angles, and next steps.',
    template: 'brainstorm',
    mode: 'auto',
  },
  outline: {
    icon: 'O',
    label: 'Outline',
    placeholder: 'Describe the structure you want...',
    desc: 'Turn an idea into a structured outline.',
    template: 'outline',
    mode: 'hybrid',
  },
};

function getStorageKey(workspaceId: string) {
  return `agent:last-run:${workspaceId}`;
}

function mergeStep(steps: AgentRunStep[], nextStep: AgentRunStep): AgentRunStep[] {
  const index = steps.findIndex((step) => step.id === nextStep.id || step.stepKey === nextStep.stepKey);
  if (index === -1) return [...steps, nextStep].sort((a, b) => a.position - b.position);
  const next = [...steps];
  next[index] = nextStep;
  return next.sort((a, b) => a.position - b.position);
}

export default function AgentPanel({
  workspaceId,
  activeDoc,
  workspaceMembershipSummary,
}: {
  workspaceId: string;
  activeDoc: any;
  workspaceMembershipSummary?: WorkspaceMembershipSummary | null;
}) {
  const appContext = useOptionalAppContext();
  const membership = workspaceMembershipSummary ?? appContext?.workspaceMembershipSummary ?? null;
  const permissions = membership?.permissionSummary ?? {
    canViewWorkspace: true,
    canManageMembers: false,
    canManageSettings: false,
    canEditDocuments: false,
    canDeleteDocuments: false,
    canRunAutomation: false,
  };
  const [mode, setMode] = useState<AgentMode>('research');
  const [input, setInput] = useState('');
  const [run, setRun] = useState<AgentRun | null>(null);
  const [createPending, setCreatePending] = useState(false);
  const [streamPending, setStreamPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [streamingAnswer, setStreamingAnswer] = useState('');
  const abortRef = useRef<(() => void) | null>(null);
  const streamingAnswerRef = useRef('');

  const activeStatus = run?.status;
  const isBusy = createPending || streamPending;
  const storageKey = useMemo(() => getStorageKey(workspaceId), [workspaceId]);

  const updateStreamingAnswer = useCallback((updater: (prev: string) => string) => {
    setStreamingAnswer((prev) => {
      const next = updater(prev);
      streamingAnswerRef.current = next;
      return next;
    });
  }, []);

  const stopStreaming = useCallback(() => {
    abortRef.current?.();
    abortRef.current = null;
    setStreamPending(false);
  }, []);

  const restoreRun = useCallback(async (runId: string, shouldAttach = true) => {
    if (!workspaceId || !runId) return;

    try {
      const nextRun = await getAgentRun(runId, workspaceId);
      setRun(nextRun);
      localStorage.setItem(storageKey, runId);

      if ((nextRun.status === 'queued' || nextRun.status === 'running') && shouldAttach) {
        stopStreaming();
        setStreamPending(true);

        const stop = streamAgentRun(
          runId,
          workspaceId,
          (data) => {
            if (data.type === 'step') {
              const nextStep = data.step as AgentRunStep;
              setRun((prev) => (prev ? { ...prev, steps: mergeStep(prev.steps, nextStep) } : prev));
              return;
            }

            if (data.type === 'token') {
              updateStreamingAnswer((prev) => prev + String(data.token ?? ''));
              return;
            }

            if (data.type === 'run') {
              const nextSnapshot = data.run as AgentRun;
              setRun(nextSnapshot);
              if (!streamingAnswerRef.current && typeof nextSnapshot.result?.answer === 'string') {
                updateStreamingAnswer(() => nextSnapshot.result?.answer ?? '');
              }
              if (nextSnapshot.status === 'failed' && nextSnapshot.errorSummary) {
                setRuntimeError(nextSnapshot.errorSummary);
              }
              return;
            }

            if (data.type === 'error') {
              setRuntimeError(String(data.message ?? 'Agent run failed'));
            }
          },
          async () => {
            setStreamPending(false);
            abortRef.current = null;
            try {
              const latest = await getAgentRun(runId, workspaceId);
              setRun(latest);
              if (latest.status === 'failed' && latest.errorSummary) {
                setRuntimeError(latest.errorSummary);
              }
            } catch {
              // Keep the latest streamed snapshot if final reconcile fails.
            }
          },
          async () => {
            setStreamPending(false);
            abortRef.current = null;
            try {
              const latest = await getAgentRun(runId, workspaceId);
              setRun(latest);
              setRuntimeError(latest.errorSummary ?? 'Failed to attach run stream');
            } catch {
              setRuntimeError('Failed to attach run stream');
            }
          }
        );

        abortRef.current = stop;
      }
    } catch {
      setRuntimeError('Failed to load run state');
    }
  }, [storageKey, stopStreaming, updateStreamingAnswer, workspaceId]);

  useEffect(() => {
    if (!workspaceId) return;
    const lastRunId = localStorage.getItem(storageKey);
    if (!lastRunId) return;
    void restoreRun(lastRunId);
    return () => {
      stopStreaming();
    };
  }, [restoreRun, stopStreaming, storageKey, workspaceId]);

  const handleStart = useCallback(async () => {
    if (!permissions.canRunAutomation || !workspaceId || !input.trim() || createPending) return;

    setCreatePending(true);
    setSaved(false);
    setRuntimeError(null);
    updateStreamingAnswer(() => '');
    stopStreaming();

    try {
      const config = MODE_CONFIG[mode];
      const nextRun = await createAgentRun(input.trim(), workspaceId, {
        mode: config.mode,
        template: config.template,
      });

      setRun(nextRun);
      localStorage.setItem(storageKey, nextRun.id);

      if (nextRun.status === 'failed' && nextRun.errorSummary) {
        setRuntimeError(nextRun.errorSummary);
      } else {
        await restoreRun(nextRun.id, true);
      }
    } catch {
      setRuntimeError('Failed to create agent run');
    } finally {
      setCreatePending(false);
    }
  }, [createPending, input, mode, permissions.canRunAutomation, restoreRun, stopStreaming, storageKey, updateStreamingAnswer, workspaceId]);

  const handleRetry = useCallback(async () => {
    if (!permissions.canRunAutomation || run?.status !== 'failed') return;
    await handleStart();
  }, [handleStart, permissions.canRunAutomation, run?.status]);

  const handleSaveToDoc = useCallback(async () => {
    if (!permissions.canEditDocuments) {
      setRuntimeError('You have view access only and cannot save agent output to a document.');
      return;
    }
    const answer = run?.result?.answer || streamingAnswerRef.current;
    if (!answer || !workspaceId) return;

    const config = MODE_CONFIG[mode];
    const title = `${config.icon} ${config.label}: ${input.slice(0, 30)}`;
    try {
      await api('/documents', {
        method: 'POST',
        body: JSON.stringify({
          workspace_id: workspaceId,
          title,
          content: { text: answer },
        }),
      });
      setSaved(true);
    } catch {
      setRuntimeError('Failed to save result to document');
    }
  }, [input, mode, permissions.canEditDocuments, run?.result?.answer, workspaceId]);

  const handleUseDoc = useCallback(() => {
    if (activeDoc?.title) {
      setInput(String(activeDoc.title));
    }
  }, [activeDoc]);

  const handleSelectRun = useCallback((runId: string) => {
    setRuntimeError(null);
    updateStreamingAnswer(() => '');
    void restoreRun(runId, true);
  }, [restoreRun, updateStreamingAnswer]);

  const resultAnswer = typeof run?.result?.answer === 'string' ? run.result.answer : undefined;
  const finalAnswer = resultAnswer || (streamingAnswer.length > 0 ? streamingAnswer : undefined);
  const canRetry = permissions.canRunAutomation && run?.status === 'failed' && !createPending;

  return (
    <div className="flex h-full flex-col gap-3 bg-surface p-3">
      <div className="grid grid-cols-4 gap-1 rounded-xl border border-border bg-surface-tertiary p-1">
        {(Object.entries(MODE_CONFIG) as [AgentMode, typeof MODE_CONFIG[AgentMode]][]).map(([nextMode, config]) => (
          <button
            key={nextMode}
            onClick={() => setMode(nextMode)}
            title={config.desc}
            className={`flex flex-col items-center gap-0.5 rounded-lg py-1.5 text-xs transition-all ${
              mode === nextMode ? 'bg-accent text-white shadow-sm' : 'text-text-tertiary hover:bg-surface hover:text-text-primary'
            }`}
          >
            <span className="text-sm">{config.icon}</span>
            <span className="text-[10px] leading-tight">{config.label}</span>
          </button>
        ))}
      </div>

      <p className="px-1 text-xs text-text-tertiary">{MODE_CONFIG[mode].desc}</p>

      {!permissions.canRunAutomation ? (
        <ForbiddenState
          title="Read-only agent access"
          description="You can review existing runs, but only editors and admins can start or retry agent and automation runs."
        />
      ) : null}

      <div className="space-y-2">
        <textarea
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder={MODE_CONFIG[mode].placeholder}
          rows={3}
          disabled={!permissions.canRunAutomation}
          className="w-full resize-none rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text-primary outline-none placeholder:text-text-tertiary focus:ring-2 focus:ring-accent disabled:opacity-60"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
              void handleStart();
            }
          }}
        />

        <div className="flex items-center gap-2">
          {activeDoc && (
            <button
              onClick={handleUseDoc}
              className="max-w-[160px] truncate text-xs text-text-tertiary underline underline-offset-2 transition-colors hover:text-accent"
              title={`Use active doc: ${String(activeDoc.title ?? '')}`}
            >
              Use doc: {String(activeDoc.title ?? '').slice(0, 16)}
            </button>
          )}
          <div className="flex-1" />
          <span className="text-xs text-text-tertiary">Cmd/Ctrl+Enter</span>
          {streamPending ? (
            <button
              onClick={stopStreaming}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-tertiary"
            >
              Detach
            </button>
          ) : (
            <button
              onClick={() => void handleStart()}
              disabled={!permissions.canRunAutomation || !input.trim() || createPending}
              className="rounded-lg bg-accent px-4 py-1.5 text-sm text-white transition-colors hover:bg-accent-hover disabled:opacity-40"
            >
              {createPending ? 'Creating...' : 'Run'}
            </button>
          )}
        </div>
      </div>

      <AgentRunHistory
        workspaceId={workspaceId}
        activeRunId={run?.id ?? null}
        onSelectRun={handleSelectRun}
      />

      {run && (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto">
          <div className="rounded-xl border border-border bg-panel p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-mono text-text-tertiary">#{run.id.slice(0, 8)}</p>
                <p className={`mt-1 text-sm font-medium ${STATUS_COLOR[run.status]}`}>
                  {STATUS_COPY[run.status]}
                </p>
                <p className="mt-1 text-xs text-text-tertiary">{run.inputSummary}</p>
              </div>
              <div className="text-right text-xs text-text-tertiary">
                <p>{new Date(run.createdAt).toLocaleString()}</p>
                {run.finishedAt && <p className="mt-1">Finished: {new Date(run.finishedAt).toLocaleTimeString()}</p>}
              </div>
            </div>

            {runtimeError && (
              <div className="mt-3 rounded-lg border border-error/20 bg-error/5 px-3 py-2 text-xs text-error">
                {runtimeError}
              </div>
            )}

            {run.status === 'queued' && (
              <p className="mt-3 text-xs text-text-secondary">Run created. Preparing execution.</p>
            )}

            {run.status === 'running' && (
              <p className="mt-3 text-xs text-text-secondary">Execution is in progress. Stream events are attached to this run.</p>
            )}

            {canRetry && (
              <div className="mt-3">
                <button
                  onClick={() => void handleRetry()}
                  className="rounded-lg border border-accent px-3 py-1.5 text-xs text-accent transition-colors hover:bg-accent-light"
                >
                  Retry as new run
                </button>
              </div>
            )}
          </div>

          {run.steps.map((step) => (
            <div key={step.id || step.stepKey} className="rounded-xl border border-border bg-panel p-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-text-secondary">{step.name}</span>
                <span className="text-[11px] text-text-tertiary">{step.status}</span>
              </div>
              {step.output != null && (
                <p className="mt-1.5 line-clamp-2 text-xs text-text-tertiary">
                  {typeof step.output === 'string' ? step.output : JSON.stringify(step.output).slice(0, 160)}
                </p>
              )}
              {step.error && (
                <p className="mt-1.5 text-xs text-error">{step.error}</p>
              )}
            </div>
          ))}

          {finalAnswer && (
            <div className="rounded-xl border border-accent-muted bg-accent-light p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-medium text-accent">Final Output</p>
                <button
                  onClick={() => void handleSaveToDoc()}
                  disabled={saved || isBusy || !permissions.canEditDocuments}
                  className="rounded-lg bg-accent-muted px-2 py-0.5 text-xs text-accent transition-colors hover:bg-accent-light disabled:opacity-40"
                >
                  {saved ? 'Saved' : 'Save to doc'}
                </button>
              </div>
              <p className="whitespace-pre-wrap text-xs leading-relaxed text-text-secondary">{finalAnswer}</p>
            </div>
          )}
        </div>
      )}

      {!run && !isBusy && (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center text-text-tertiary">
            <div className="mb-2 text-3xl">AI</div>
            <p className="text-xs">Create a run first, then stream and restore it by run ID.</p>
            <p className="mt-1 text-xs text-text-secondary">Runs remain queryable after reload.</p>
          </div>
        </div>
      )}
    </div>
  );
}

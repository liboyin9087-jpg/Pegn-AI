import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  api,
  createAgentRun,
  getAgentRun,
  rerunAgentRun,
  listAgentRuns,
  streamAgentRun,
  trackProductEvent,
  type AgentRun,
  type AgentRunDetail,
  type AgentRunListItem,
  type SurfaceLinkTarget,
  type AgentRunStep,
  type WorkspaceMembershipSummary,
} from '../api/client';
import AgentRunDetailPanel from './AgentRunDetailPanel';
import AgentRunHistoryList from './AgentRunHistoryList';
import { useOptionalAppContext, useRefreshVersion } from '../contexts/AppContext';
import ForbiddenState from './ForbiddenState';

const STATUS_COPY: Record<AgentRun['status'], string> = {
  queued: 'Queued',
  running: 'Running',
  completed: 'Completed',
  failed: 'Failed',
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

function toRunDetail(run: AgentRun): AgentRunDetail {
  return {
    runId: run.id,
    workspaceId: run.workspaceId,
    threadId: run.threadId ?? null,
    type: run.type,
    mode: run.mode,
    title: run.title ?? run.type,
    status: run.status,
    input: run.input ?? run.inputSummary,
    inputSummary: run.inputSummary,
    output: run.output ?? (typeof run.result?.answer === 'string' ? run.result.answer : null),
    outputSummary: run.outputSummary ?? null,
    errorCode: run.status === 'failed' ? 'agent_run_failed' : null,
    errorSummary: run.errorSummary ?? null,
    jobId: run.jobId ?? run.lastJobId ?? null,
    promptVersion: run.promptVersion ?? null,
    promptLabel: run.promptLabel ?? null,
    templateId: run.templateId ?? null,
    templateVersion: run.templateVersion ?? null,
    citations: run.citations ?? [],
    relatedArtifacts: run.relatedArtifacts ?? [],
    createdAt: run.createdAt,
    startedAt: run.startedAt ?? null,
    finishedAt: run.finishedAt ?? null,
    rerunOfRunId: run.rerunOfRunId ?? null,
    steps: run.steps,
  };
}

export default function AgentPanel({
  workspaceId,
  activeDoc,
  workspaceMembershipSummary,
  onOpenJob,
  navigationTarget,
  onOpenSurfaceTarget,
}: {
  workspaceId: string;
  activeDoc: any;
  workspaceMembershipSummary?: WorkspaceMembershipSummary | null;
  onOpenJob?: (jobId: string) => void;
  navigationTarget?: SurfaceLinkTarget | null;
  onOpenSurfaceTarget?: (target: SurfaceLinkTarget) => void;
}) {
  const appContext = useOptionalAppContext();
  const savedContext = appContext?.surfaceContexts?.agent;
  const refreshVersion = useRefreshVersion('agentRuns');
  const membership = workspaceMembershipSummary ?? appContext?.workspaceMembershipSummary ?? null;
  const permissions = membership?.permissionSummary ?? {
    canViewWorkspace: true,
    canManageMembers: false,
    canManageSettings: false,
    canEditDocuments: false,
    canDeleteDocuments: false,
    canRunAutomation: false,
    canCollaborate: false,
    canManageAssignments: false,
  };

  const [mode, setMode] = useState<AgentMode>('research');
  const [input, setInput] = useState('');
  const [run, setRun] = useState<AgentRunDetail | null>(null);
  const [runSteps, setRunSteps] = useState<AgentRunStep[]>([]);
  const [runs, setRuns] = useState<AgentRunListItem[]>([]);
  const [createPending, setCreatePending] = useState(false);
  const [streamPending, setStreamPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const [runtimeError, setRuntimeError] = useState<string | null>(null);
  const [streamingAnswer, setStreamingAnswer] = useState('');
  const abortRef = useRef<(() => void) | null>(null);
  const streamingAnswerRef = useRef('');

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

  const refreshRunList = useCallback(async () => {
    if (!workspaceId || !permissions.canViewWorkspace) return;
    try {
      const response = await listAgentRuns(workspaceId, { limit: 8 });
      setRuns(response.items);
    } catch {
      // Keep the existing list if refresh fails.
    }
  }, [permissions.canViewWorkspace, workspaceId]);

  const restoreRun = useCallback(async (runId: string, shouldAttach = true) => {
    if (!workspaceId || !runId) return;

    try {
      const nextRun = await getAgentRun(runId, workspaceId);
      setRun(nextRun);
      setRunSteps(nextRun.steps ?? []);
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
              setRunSteps((prev) => mergeStep(prev, nextStep));
              setRun((prev) => (prev ? { ...prev, steps: mergeStep(prev.steps ?? [], nextStep) } : prev));
              return;
            }

            if (data.type === 'token') {
              updateStreamingAnswer((prev) => prev + String(data.token ?? ''));
              return;
            }

            if (data.type === 'run') {
              const nextSnapshot = toRunDetail(data.run as AgentRun);
              setRun(nextSnapshot);
              setRunSteps(nextSnapshot.steps ?? []);
              if (!streamingAnswerRef.current && nextSnapshot.output) {
                updateStreamingAnswer(() => nextSnapshot.output ?? '');
              }
              if (nextSnapshot.status === 'failed' && nextSnapshot.errorSummary) {
                setRuntimeError(nextSnapshot.errorSummary);
              }
            }
          },
          async () => {
            setStreamPending(false);
            abortRef.current = null;
            await refreshRunList();
            try {
              const latest = await getAgentRun(runId, workspaceId);
              setRun(latest);
              setRunSteps(latest.steps ?? []);
              if (latest.status === 'failed' && latest.errorSummary) {
                setRuntimeError(latest.errorSummary);
              }
            } catch {
              // Keep latest streamed snapshot.
            }
          },
          async () => {
            setStreamPending(false);
            abortRef.current = null;
            try {
              const latest = await getAgentRun(runId, workspaceId);
              setRun(latest);
              setRunSteps(latest.steps ?? []);
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
  }, [refreshRunList, storageKey, stopStreaming, updateStreamingAnswer, workspaceId]);

  useEffect(() => {
    void refreshRunList();
  }, [refreshRunList, refreshVersion]);

  useEffect(() => {
    if (!workspaceId) return;
    const lastRunId = localStorage.getItem(storageKey);
    if (!lastRunId) return;
    void restoreRun(lastRunId);
    return () => {
      stopStreaming();
    };
  }, [restoreRun, stopStreaming, storageKey, workspaceId]);

  useEffect(() => {
    if (!navigationTarget || navigationTarget.surface !== 'agent') return;
    const targetRunId = navigationTarget.payload.runId;
    if (targetRunId) {
      void restoreRun(targetRunId, true);
    }
  }, [navigationTarget, restoreRun]);

  useEffect(() => {
    if (!savedContext) return;
    if (savedContext.agentType && savedContext.agentType in MODE_CONFIG) {
      setMode(savedContext.agentType as AgentMode);
    }
    if (savedContext.selectedRunId && savedContext.detailOpen) {
      void restoreRun(savedContext.selectedRunId, true);
    }
  }, [restoreRun, savedContext]);

  useEffect(() => {
    appContext?.setSurfaceContext?.('agent', {
      threadId: run?.threadId ?? null,
      status: null,
      agentType: mode,
      selectedRunId: run?.runId ?? null,
      detailOpen: Boolean(run),
      showFailuresOnly: false,
    });
  }, [appContext, mode, run]);

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

      if (appContext?.user?.id) {
        void trackProductEvent('agent_run_created', {
          workspaceId,
          userId: appContext.user.id,
          surface: 'agent',
          targetType: 'run',
          targetId: nextRun.runId ?? nextRun.id,
          metadata: { mode, template: config.template },
        }).catch(() => undefined);
      }

      await refreshRunList();
      const nextRunId = nextRun.runId ?? nextRun.id;
      await restoreRun(nextRunId, true);
      appContext?.requestRefresh(['agentRuns', 'jobs', 'admin', 'audit', 'inbox']);
    } catch {
      setRuntimeError('Failed to create agent run');
    } finally {
      setCreatePending(false);
    }
  }, [createPending, input, mode, permissions.canRunAutomation, refreshRunList, restoreRun, stopStreaming, updateStreamingAnswer, workspaceId]);

  const handleRerun = useCallback(async () => {
    if (!permissions.canRunAutomation || !run) return;
    setRuntimeError(null);
    try {
      if (appContext?.user?.id) {
        void trackProductEvent('agent_rerun_clicked', {
          workspaceId,
          userId: appContext.user.id,
          surface: 'agent',
          targetType: 'run',
          targetId: run.runId,
          metadata: { jobId: run.jobId ?? null },
        }).catch(() => undefined);
      }
      const rerun = await rerunAgentRun(run.runId, workspaceId);
      await refreshRunList();
      await restoreRun(rerun.runId, true);
      appContext?.requestRefresh(['agentRuns', 'jobs', 'admin', 'audit', 'inbox']);
    } catch {
      setRuntimeError('Failed to rerun agent workflow');
    }
  }, [appContext, permissions.canRunAutomation, refreshRunList, restoreRun, run, workspaceId]);

  const handleSaveToDoc = useCallback(async () => {
    if (!permissions.canEditDocuments) {
      setRuntimeError('You have view access only and cannot save agent output to a document.');
      return;
    }
    const answer = run?.output || streamingAnswerRef.current;
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
  }, [input, mode, permissions.canEditDocuments, run?.output, workspaceId]);

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

  const finalAnswer = run?.output || (streamingAnswer.length > 0 ? streamingAnswer : undefined);
  const canRerun = permissions.canRunAutomation && !!run;

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
          description="You can review existing runs, but only editors and admins can start or rerun agent and automation work."
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

      <AgentRunHistoryList
        items={runs}
        activeRunId={run?.runId ?? null}
        onSelectRun={handleSelectRun}
      />

      {run ? (
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
          <div className="rounded-xl border border-border bg-panel p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="text-xs font-mono text-text-tertiary">#{run.runId.slice(0, 8)}</p>
                <p className="mt-1 text-sm font-medium text-text-primary">{STATUS_COPY[run.status]}</p>
                <p className="mt-1 text-xs text-text-tertiary">{run.inputSummary ?? run.input}</p>
              </div>
              <div className="text-right text-xs text-text-tertiary">
                <p>{new Date(run.createdAt).toLocaleString()}</p>
                {run.finishedAt ? <p className="mt-1">Finished: {new Date(run.finishedAt).toLocaleTimeString()}</p> : null}
              </div>
            </div>

            {runtimeError ? (
              <div className="mt-3 rounded-lg border border-error/20 bg-error/5 px-3 py-2 text-xs text-error">
                {runtimeError}
              </div>
            ) : null}

            <div className="mt-3 flex flex-wrap items-center gap-2">
              {run.jobId && onOpenJob ? (
                <button
                  onClick={() => {
                    if (run.jobTarget && onOpenSurfaceTarget) {
                      onOpenSurfaceTarget(run.jobTarget);
                      return;
                    }
                    onOpenJob(run.jobId!);
                  }}
                  className="rounded-lg border border-border px-3 py-1.5 text-xs text-text-secondary transition-colors hover:bg-surface-tertiary"
                >
                  View job trace
                </button>
              ) : null}
              {canRerun ? (
                <button
                  onClick={() => void handleRerun()}
                  className="rounded-lg border border-accent px-3 py-1.5 text-xs text-accent transition-colors hover:bg-accent-light"
                >
                  Rerun
                </button>
              ) : null}
            </div>
          </div>

          <AgentRunDetailPanel
            run={{ ...run, output: finalAnswer ?? run.output ?? null, steps: runSteps }}
            canRerun={canRerun}
            onRerun={() => void handleRerun()}
            onOpenJob={onOpenJob}
            onOpenJobTrace={run.jobTarget && onOpenSurfaceTarget ? () => onOpenSurfaceTarget(run.jobTarget!) : undefined}
          />

          {runSteps.length > 0 ? (
            <div className="space-y-2">
              {runSteps.map((step) => (
                <div key={step.id || step.stepKey} className="rounded-xl border border-border bg-panel p-3">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-text-secondary">{step.name}</span>
                    <span className="text-[11px] text-text-tertiary">{step.status}</span>
                  </div>
                  {step.output != null ? (
                    <p className="mt-1.5 line-clamp-2 text-xs text-text-tertiary">
                      {typeof step.output === 'string' ? step.output : JSON.stringify(step.output).slice(0, 160)}
                    </p>
                  ) : null}
                  {step.error ? <p className="mt-1.5 text-xs text-error">{step.error}</p> : null}
                </div>
              ))}
            </div>
          ) : null}

          {finalAnswer ? (
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
          ) : null}
        </div>
      ) : !isBusy ? (
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center text-text-tertiary">
            <div className="mb-2 text-3xl">AI</div>
            <p className="text-xs">Create a run first, then inspect the canonical run detail.</p>
            <p className="mt-1 text-xs text-text-secondary">Runs remain queryable after reload.</p>
          </div>
        </div>
      ) : null}
    </div>
  );
}

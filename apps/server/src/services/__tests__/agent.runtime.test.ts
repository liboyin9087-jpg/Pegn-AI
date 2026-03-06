import { beforeEach, describe, expect, it, vi } from 'vitest';

type RunRecord = {
  id: string;
  workspace_id: string;
  user_id: string;
  type: string;
  query: string;
  mode: 'auto' | 'hybrid' | 'graph';
  status: string;
  input_summary: string | null;
  output_summary: string | null;
  error_summary: string | null;
  result: Record<string, unknown> | null;
  error: string | null;
  token_usage: number | null;
  parent_run_id: string | null;
  root_run_id: string | null;
  depth: number;
  created_at: Date;
  started_at: Date | null;
  finished_at: Date | null;
};

type StepRecord = {
  id: string;
  run_id: string;
  step_key: string;
  status: string;
  error: string | null;
};

const mockPool = { query: vi.fn() };

vi.mock('../../db/client.js', () => ({ pool: mockPool }));

let runs: RunRecord[] = [];
let steps: StepRecord[] = [];
let runCounter = 0;

function resetState() {
  runs = [];
  steps = [];
  runCounter = 0;
}

function findRun(id: string, workspaceId?: string, userId?: string) {
  return runs.find((run) =>
    run.id === id &&
    (workspaceId ? run.workspace_id === workspaceId : true) &&
    (userId ? run.user_id === userId : true)
  );
}

function installDbMock() {
  mockPool.query.mockImplementation(async (sql: string, params: any[] = []) => {
    const normalized = sql.replace(/\s+/g, ' ').trim().toLowerCase();

    if (normalized.startsWith('insert into agent_runs')) {
      const record: RunRecord = {
        id: params[0],
        workspace_id: params[1],
        user_id: params[2],
        type: params[3],
        query: params[4],
        mode: params[5],
        status: 'queued',
        input_summary: params[6],
        output_summary: null,
        error_summary: null,
        result: {},
        error: null,
        token_usage: 0,
        parent_run_id: params[7],
        root_run_id: params[8],
        depth: params[9],
        created_at: new Date('2026-03-07T10:00:00.000Z'),
        started_at: null,
        finished_at: null,
      };
      runs.push(record);
      return { rows: [], rowCount: 1 };
    }

    if (normalized.startsWith('select * from agent_runs where id = $1')) {
      const row = findRun(params[0], params[1], params[2]) ?? findRun(params[0], params[1]) ?? findRun(params[0]);
      return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
    }

    if (normalized.startsWith('select * from agent_steps where run_id = $1')) {
      return { rows: steps.filter((step) => step.run_id === params[0]), rowCount: steps.filter((step) => step.run_id === params[0]).length };
    }

    if (normalized.startsWith('update agent_runs set status = \'running\'')) {
      const row = findRun(params[0], params[1], params[2]);
      if (row) {
        row.status = 'running';
        row.started_at = new Date('2026-03-07T10:01:00.000Z');
      }
      return { rows: [], rowCount: row ? 1 : 0 };
    }

    if (normalized.startsWith('update agent_runs set status = \'completed\'')) {
      const row = findRun(params[0], params[1], params[2]);
      if (row) {
        row.status = 'completed';
        row.result = params[3] ? JSON.parse(params[3]) : row.result;
        row.output_summary = params[4];
        row.error_summary = null;
        row.error = null;
        row.token_usage = params[5] ?? row.token_usage;
        row.finished_at = new Date('2026-03-07T10:02:00.000Z');
      }
      return { rows: [], rowCount: row ? 1 : 0 };
    }

    if (normalized.startsWith('update agent_runs set status = \'failed\'')) {
      if (normalized.includes('where id = any')) {
        const ids = params[0] as string[];
        const message = params[1];
        runs.forEach((run) => {
          if (ids.includes(run.id)) {
            run.status = 'failed';
            run.error_summary = message;
            run.error = message;
            run.finished_at = new Date('2026-03-07T10:03:00.000Z');
          }
        });
        return { rows: [], rowCount: ids.length };
      }

      const row = findRun(params[0], params[1], params[2]);
      if (row) {
        row.status = 'failed';
        row.error_summary = params[3];
        row.error = params[3];
        row.finished_at = new Date('2026-03-07T10:03:00.000Z');
      }
      return { rows: [], rowCount: row ? 1 : 0 };
    }

    if (normalized.startsWith('select * from agent_runs where workspace_id = $1 and user_id = $2')) {
      const rows = runs
        .filter((run) => run.workspace_id === params[0] && run.user_id === params[1])
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())
        .slice(0, params[2]);
      return { rows, rowCount: rows.length };
    }

    if (normalized.startsWith('select id from agent_runs where status = \'running\'')) {
      const rows = runs.filter((run) => run.status === 'running').map((run) => ({ id: run.id }));
      return { rows, rowCount: rows.length };
    }

    if (normalized.startsWith('update agent_steps set status = \'aborted\'')) {
      const ids = params[0] as string[];
      steps.forEach((step) => {
        if (ids.includes(step.run_id) && step.status === 'running') {
          step.status = 'aborted';
          step.error = 'Step interrupted by server restart';
        }
      });
      return { rows: [], rowCount: 1 };
    }

    if (normalized.startsWith('insert into agent_steps')) {
      runCounter += 1;
      steps.push({
        id: `step-${runCounter}`,
        run_id: params[0],
        step_key: params[1],
        status: 'pending',
        error: null,
      });
      return { rows: [], rowCount: 1 };
    }

    throw new Error(`Unhandled SQL: ${normalized} -- ${JSON.stringify(params)}`);
  });
}

describe('agent runtime lifecycle', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetState();
    installDbMock();
  });

  it('creates a queued run', async () => {
    const { createAgentRun } = await import('../agent.js');
    const run = await createAgentRun({
      runId: 'run-1',
      workspaceId: 'ws-1',
      userId: 'user-1',
      input: 'Summarize the roadmap',
    });

    expect(run.id).toBe('run-1');
    expect(run.status).toBe('queued');
    expect(run.createdAt).toBeTruthy();
    expect(run.inputSummary).toContain('Summarize');
  });

  it('transitions queued -> running -> completed', async () => {
    const { createAgentRun, startAgentRun, completeAgentRun } = await import('../agent.js');
    await createAgentRun({
      runId: 'run-2',
      workspaceId: 'ws-1',
      userId: 'user-1',
      input: 'Write a plan',
    });

    const running = await startAgentRun('run-2', 'ws-1', 'user-1');
    expect(running.status).toBe('running');
    expect(running.startedAt).toBeTruthy();

    const completed = await completeAgentRun('run-2', 'ws-1', 'user-1', {
      result: { answer: 'Final answer' },
    });
    expect(completed.status).toBe('completed');
    expect(completed.finishedAt).toBeTruthy();
    expect(completed.outputSummary).toContain('Final answer');
  });

  it('transitions running -> failed and preserves immutable terminal state', async () => {
    const { createAgentRun, startAgentRun, failAgentRun, completeAgentRun } = await import('../agent.js');
    await createAgentRun({
      runId: 'run-3',
      workspaceId: 'ws-1',
      userId: 'user-1',
      input: 'Run a failing task',
    });
    await startAgentRun('run-3', 'ws-1', 'user-1');

    const failed = await failAgentRun('run-3', 'ws-1', 'user-1', 'model unavailable');
    expect(failed.status).toBe('failed');
    expect(failed.finishedAt).toBeTruthy();
    expect(failed.errorSummary).toBe('Model unavailable');

    await expect(completeAgentRun('run-3', 'ws-1', 'user-1', {
      result: { answer: 'Should not work' },
    })).rejects.toThrow(/invalid run transition/i);
  });

  it('enforces workspace_id and user_id scope on reads', async () => {
    const { createAgentRun, getAgentRunById } = await import('../agent.js');
    await createAgentRun({
      runId: 'run-4',
      workspaceId: 'ws-1',
      userId: 'user-1',
      input: 'Visible only to owner',
    });

    const visible = await getAgentRunById('run-4', 'ws-1', 'user-1');
    const hiddenWrongUser = await getAgentRunById('run-4', 'ws-1', 'user-2');
    const hiddenWrongWorkspace = await getAgentRunById('run-4', 'ws-2', 'user-1');

    expect(visible?.id).toBe('run-4');
    expect(hiddenWrongUser).toBeNull();
    expect(hiddenWrongWorkspace).toBeNull();
  });

  it('recovers orphaned running runs on boot as failed', async () => {
    runs.push({
      id: 'run-boot',
      workspace_id: 'ws-1',
      user_id: 'user-1',
      type: 'supervisor',
      query: 'Boot recovery',
      mode: 'auto',
      status: 'running',
      input_summary: 'Boot recovery',
      output_summary: null,
      error_summary: null,
      result: {},
      error: null,
      token_usage: 0,
      parent_run_id: null,
      root_run_id: 'run-boot',
      depth: 0,
      created_at: new Date('2026-03-07T10:00:00.000Z'),
      started_at: new Date('2026-03-07T10:01:00.000Z'),
      finished_at: null,
    });
    steps.push({
      id: 'step-running',
      run_id: 'run-boot',
      step_key: 'planner',
      status: 'running',
      error: null,
    });

    const { recoverRunningRunsOnBoot } = await import('../agent.js');
    const recovered = await recoverRunningRunsOnBoot();

    expect(recovered).toBe(1);
    expect(runs[0].status).toBe('failed');
    expect(runs[0].error_summary).toMatch(/server restart/i);
    expect(steps[0].status).toBe('aborted');
  });
});

/**
 * automation.ts — Automation Engine
 *
 * Architecture:
 *   AutomationEventBus  → emits typed workspace events
 *   AutomationEngine    → evaluates triggers/conditions → executes actions
 *   SchedulerService    → polls schedule-based automations via setInterval
 *
 * Supported trigger_type:
 *   doc_created | doc_updated | doc_deleted
 *   property_changed | status_changed
 *   comment_created
 *   schedule  (relies on schedule_cron stored as "every_N_minutes" or ISO interval)
 *
 * Supported actions:
 *   run_agent        — fire a supervisor agent run
 *   send_webhook     — POST to external URL
 *   notify           — create inbox notification for workspace members
 *   update_property  — set collection item property value
 */

import crypto from 'node:crypto';
import { pool } from '../db/client.js';
import { observability } from './observability.js';
import { startSupervisorRun } from './agent.js';

// ── Types ──────────────────────────────────────────────────────────────────

export type TriggerType =
  | 'doc_created' | 'doc_updated' | 'doc_deleted'
  | 'property_changed' | 'status_changed'
  | 'comment_created' | 'schedule';

export type ActionType =
  | 'run_agent' | 'send_webhook' | 'notify' | 'update_property';

export interface AutomationEvent {
  type: TriggerType;
  workspaceId: string;
  entityType?: 'document' | 'collection' | 'comment';
  entityId?: string;
  payload?: Record<string, unknown>;
  triggeredBy?: string; // userId
}

export interface AutomationRow {
  id: string;
  workspace_id: string;
  created_by: string;
  name: string;
  description: string | null;
  enabled: boolean;
  trigger_type: TriggerType;
  trigger_config: Record<string, unknown>;
  conditions: ConditionRule[];
  actions: ActionConfig[];
  schedule_cron: string | null;
  last_triggered_at: Date | null;
  run_count: number;
  created_at: Date;
  updated_at: Date;
}

export interface ConditionRule {
  field: string;       // e.g. "payload.status"
  operator: 'eq' | 'neq' | 'contains' | 'gt' | 'lt' | 'exists';
  value?: unknown;
}

export interface ActionConfig {
  type: ActionType;
  config: Record<string, unknown>;
}

// ── EventBus ───────────────────────────────────────────────────────────────
// Minimal typed event bus — no external dependencies

type EventListener = (e: AutomationEvent) => void;

class AutomationEventBus {
  private readonly _listeners: Map<string, EventListener[]> = new Map();

  on(event: string, listener: EventListener): this {
    const list = this._listeners.get(event) ?? [];
    list.push(listener);
    this._listeners.set(event, list);
    return this;
  }

  off(event: string, listener: EventListener): this {
    const list = this._listeners.get(event) ?? [];
    this._listeners.set(event, list.filter(l => l !== listener));
    return this;
  }

  emit(event: string, payload: AutomationEvent): void {
    const list = this._listeners.get(event) ?? [];
    list.forEach(l => {
      try { l(payload); } catch { /* swallow listener errors */ }
    });
  }

  removeAllListeners(event?: string): this {
    if (event) this._listeners.delete(event);
    else this._listeners.clear();
    return this;
  }
}

export const automationEventBus = new AutomationEventBus();

// ── Condition evaluator ────────────────────────────────────────────────────

function getNestedValue(obj: Record<string, unknown>, path: string): unknown {
  return path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, obj);
}

function evaluateCondition(condition: ConditionRule, context: Record<string, unknown>): boolean {
  const actual = getNestedValue(context, condition.field);
  switch (condition.operator) {
    case 'eq':       return actual === condition.value;
    case 'neq':      return actual !== condition.value;
    case 'contains': return typeof actual === 'string' && actual.includes(String(condition.value));
    case 'gt':       return Number(actual) > Number(condition.value);
    case 'lt':       return Number(actual) < Number(condition.value);
    case 'exists':   return actual !== undefined && actual !== null;
    default:         return false;
  }
}

function evaluateConditions(conditions: ConditionRule[], context: Record<string, unknown>): boolean {
  if (!conditions || conditions.length === 0) return true;
  return conditions.every(c => evaluateCondition(c, context));
}

// ── Action executors ───────────────────────────────────────────────────────

async function executeRunAgent(config: Record<string, unknown>, context: Record<string, unknown>): Promise<Record<string, unknown>> {
  const workspaceId = context.workspaceId as string;
  const template = (config.template as string) || 'summarize';
  const query = (config.input as string) || `Automated run for workspace ${workspaceId}`;
  const runId = crypto.randomUUID();

  await startSupervisorRun({
    runId,
    workspace_id: workspaceId,
    user_id: 'system',
    query,
    mode: 'auto',
    template: template as any,
  });

  observability.info('[automation] run_agent action dispatched', { runId, template });
  return { run_id: runId, status: 'dispatched' };
}

async function executeSendWebhook(config: Record<string, unknown>, context: Record<string, unknown>): Promise<Record<string, unknown>> {
  const url = config.url as string;
  if (!url) throw new Error('send_webhook action missing url');

  const body = JSON.stringify({ ...context, timestamp: new Date().toISOString() });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    signal: AbortSignal.timeout(10_000),
  });

  observability.info('[automation] webhook fired', { url, status: res.status });
  return { url, status: res.status, ok: res.ok };
}

async function executeNotify(config: Record<string, unknown>, context: Record<string, unknown>): Promise<Record<string, unknown>> {
  const p = pool;
  if (!p) return { skipped: true, reason: 'db_unavailable' };

  const workspaceId = context.workspaceId as string;
  const message = (config.message as string) || 'An automation was triggered.';
  const title = (config.title as string) || 'Automation';

  // Notify all workspace members
  const members = await p.query(
    'SELECT user_id FROM workspace_members WHERE workspace_id = $1',
    [workspaceId]
  );

  const inserts: Promise<unknown>[] = [];
  for (const row of members.rows) {
    inserts.push(
      p.query(
        `INSERT INTO inbox_notifications
           (user_id, workspace_id, type, title, body, metadata, read)
         VALUES ($1, $2, 'automation', $3, $4, $5, false)`,
        [row.user_id, workspaceId, title, message, JSON.stringify(context)]
      ).catch(() => { /* non-fatal */ })
    );
  }

  await Promise.all(inserts);
  observability.info('[automation] notify action sent', { workspaceId, userCount: members.rows.length });
  return { notified: members.rows.length };
}

async function executeUpdateProperty(config: Record<string, unknown>, context: Record<string, unknown>): Promise<Record<string, unknown>> {
  const p = pool;
  if (!p) return { skipped: true, reason: 'db_unavailable' };

  const itemId = (config.item_id as string) || (context.entityId as string);
  const propertyKey = config.property_key as string;
  const propertyValue = config.property_value;

  if (!itemId || !propertyKey) {
    return { skipped: true, reason: 'missing item_id or property_key' };
  }

  await p.query(
    `UPDATE documents
     SET metadata = jsonb_set(COALESCE(metadata, '{}'), $1, $2::jsonb, true),
         updated_at = NOW()
     WHERE id = $3`,
    [
      `{properties,${propertyKey}}`,
      JSON.stringify(propertyValue),
      itemId,
    ]
  );

  observability.info('[automation] update_property action applied', { itemId, propertyKey });
  return { item_id: itemId, property_key: propertyKey, updated: true };
}

// ── Run recorder ───────────────────────────────────────────────────────────

async function recordRun(
  automationId: string,
  workspaceId: string,
  triggeredBy: 'event' | 'schedule' | 'manual',
  triggerPayload: Record<string, unknown>,
  status: 'done' | 'error' | 'skipped',
  actionsResult: Record<string, unknown>[],
  error?: string,
  startedAt?: Date
): Promise<void> {
  const p = pool;
  if (!p) return;

  const now = new Date();
  const durationMs = startedAt ? now.getTime() - startedAt.getTime() : 0;

  await p.query(
    `INSERT INTO automation_runs
       (automation_id, workspace_id, triggered_by, trigger_payload, status, actions_result, error, started_at, finished_at, duration_ms)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
    [
      automationId, workspaceId, triggeredBy,
      JSON.stringify(triggerPayload),
      status, JSON.stringify(actionsResult),
      error ?? null,
      startedAt ?? now, now, durationMs,
    ]
  ).catch((err: unknown) => observability.error('[automation] failed to record run', { err: String(err) }));

  // Increment run count
  await p.query(
    `UPDATE automations
     SET run_count = run_count + 1, last_triggered_at = NOW(), updated_at = NOW()
     WHERE id = $1`,
    [automationId]
  ).catch(() => { /* non-fatal */ });
}

// ── Core execution ─────────────────────────────────────────────────────────

export async function executeAutomation(
  automation: AutomationRow,
  event: AutomationEvent,
  triggeredBy: 'event' | 'schedule' | 'manual' = 'event'
): Promise<void> {
  const startedAt = new Date();
  const context: Record<string, unknown> = {
    workspaceId: event.workspaceId,
    entityType: event.entityType,
    entityId: event.entityId,
    payload: event.payload,
    triggeredBy: event.triggeredBy,
  };

  // Evaluate conditions
  if (!evaluateConditions(automation.conditions, context)) {
    await recordRun(automation.id, automation.workspace_id, triggeredBy, context, 'skipped', [], undefined, startedAt);
    return;
  }

  const actionsResult: Record<string, unknown>[] = [];
  let runError: string | undefined;

  for (const action of automation.actions) {
    try {
      let result: Record<string, unknown>;
      switch (action.type) {
        case 'run_agent':        result = await executeRunAgent(action.config, context); break;
        case 'send_webhook':     result = await executeSendWebhook(action.config, context); break;
        case 'notify':           result = await executeNotify(action.config, context); break;
        case 'update_property':  result = await executeUpdateProperty(action.config, context); break;
        default:                 result = { skipped: true, reason: 'unknown_action' };
      }
      actionsResult.push({ type: action.type, result, ok: true });
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      actionsResult.push({ type: action.type, error: errMsg, ok: false });
      runError = errMsg;
      observability.error('[automation] action failed', { automationId: automation.id, action: action.type, err: errMsg });
    }
  }

  const status = runError ? 'error' : 'done';
  await recordRun(automation.id, automation.workspace_id, triggeredBy, context, status, actionsResult, runError, startedAt);
}

// ── AutomationEngine — listens to event bus ───────────────────────────────

class AutomationEngine {
  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;

    // Listen to all automation-relevant events
    const triggers: TriggerType[] = [
      'doc_created', 'doc_updated', 'doc_deleted',
      'property_changed', 'status_changed', 'comment_created',
    ];

    for (const trigger of triggers) {
      automationEventBus.on(trigger, async (event: AutomationEvent) => {
        await this.handleEvent(event);
      });
    }

    observability.info('[automation] engine started, listening to triggers');
  }

  private async handleEvent(event: AutomationEvent): Promise<void> {
    const p = pool;
    if (!p) return;

    try {
      const { rows } = await p.query<AutomationRow>(
        `SELECT * FROM automations
         WHERE workspace_id = $1
           AND enabled = true
           AND trigger_type = $2`,
        [event.workspaceId, event.type]
      );

      for (const auto of rows) {
        // Async fire-and-forget (each automation is independent)
        executeAutomation(auto, event, 'event').catch(err =>
          observability.error('[automation] executeAutomation failed', { automationId: auto.id, err: String(err) })
        );
      }
    } catch (err) {
      observability.error('[automation] handleEvent query failed', { err: String(err), eventType: event.type });
    }
  }
}

export const automationEngine = new AutomationEngine();

// ── SchedulerService — polls schedule automations every minute ────────────

const SCHEDULE_POLL_INTERVAL_MS = 60_000; // 1 minute

class SchedulerService {
  private timer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    if (this.timer) return;

    this.timer = setInterval(async () => {
      await this.tick().catch(err =>
        observability.error('[scheduler] tick error', { err: String(err) })
      );
    }, SCHEDULE_POLL_INTERVAL_MS);

    // Run immediately on start
    this.tick().catch(() => { /* ignore startup errors */ });
    observability.info('[scheduler] started, polling every 60s');
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async tick(): Promise<void> {
    const p = pool;
    if (!p) return;

    const now = new Date();

    // Find schedule automations that are due.
    // schedule_cron value format: "every_N_minutes" (e.g. "every_5_minutes" / "every_60_minutes")
    const { rows } = await p.query<AutomationRow>(
      `SELECT * FROM automations
       WHERE enabled = true
         AND trigger_type = 'schedule'
         AND schedule_cron IS NOT NULL`
    );

    for (const auto of rows) {
      try {
        const intervalMinutes = parseScheduleCron(auto.schedule_cron!);
        if (intervalMinutes <= 0) continue;

        const lastRun = auto.last_triggered_at;
        const nextRun = lastRun
          ? new Date(lastRun.getTime() + intervalMinutes * 60_000)
          : new Date(0); // never run → run immediately

        if (now >= nextRun) {
          executeAutomation(auto, { type: 'schedule', workspaceId: auto.workspace_id }, 'schedule')
            .catch(err => observability.error('[scheduler] executeAutomation failed', { id: auto.id, err: String(err) }));
        }
      } catch (err) {
        observability.warn('[scheduler] parse error', { id: auto.id, cron: auto.schedule_cron, err: String(err) });
      }
    }
  }
}

/**
 * Parse our simple schedule_cron strings:
 *   "every_5_minutes"  → 5
 *   "every_60_minutes" → 60
 *   "every_day"        → 1440
 *   "every_hour"       → 60
 */
export function parseScheduleCron(cron: string): number {
  if (!cron) return 0;
  const lower = cron.trim().toLowerCase();

  if (lower === 'every_day')  return 1440;
  if (lower === 'every_hour') return 60;

  const match = lower.match(/^every_(\d+)_minutes?$/);
  if (match) return Math.max(1, parseInt(match[1], 10));

  return 0;
}

export const schedulerService = new SchedulerService();

// ── Bootstrap — call from index.ts ────────────────────────────────────────

export function startAutomationServices(): void {
  automationEngine.start();
  schedulerService.start();
  observability.info('[automation] all services started');
}

// ── Fire-and-forget helper for routes/services ────────────────────────────

export function emitAutomationEvent(event: AutomationEvent): void {
  automationEventBus.emit(event.type, event);
}

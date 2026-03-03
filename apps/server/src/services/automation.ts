/**
 * AI Automation Engine
 * Handles: event dispatch, condition evaluation, action execution, cron scheduling
 */
import { pool } from '../db/client.js';

// ── Types ────────────────────────────────────────────────────────────────────

export type TriggerType =
  | 'document.created'
  | 'document.updated'
  | 'document.deleted'
  | 'property.changed'
  | 'agent.completed'
  | 'schedule.cron'
  | 'webhook.received';

export type ConditionOp = 'contains' | 'not_contains' | 'eq' | 'ne' | 'gt' | 'lt' | 'regex' | 'starts_with';

export interface Condition {
  field: string;   // 'title' | 'content' | 'property.STATUS' | 'created_by'
  op: ConditionOp;
  value: string;
}

export type ActionType =
  | 'run_agent'
  | 'send_webhook'
  | 'create_document'
  | 'update_property'
  | 'notify_user';

export interface Action {
  type: ActionType;
  config: Record<string, unknown>;
}

export interface AutomationEvent {
  type: TriggerType;
  workspaceId: string;
  userId?: string;
  payload: Record<string, unknown>;
}

// ── Event Dispatcher ─────────────────────────────────────────────────────────

/**
 * Called from routes when relevant events happen.
 * Finds matching automations and executes them asynchronously.
 */
export async function dispatchEvent(event: AutomationEvent): Promise<void> {
  if (!pool) return;
  try {
    const { rows: automations } = await pool.query(
      `SELECT * FROM automations
       WHERE workspace_id = $1 AND trigger_type = $2 AND enabled = true`,
      [event.workspaceId, event.type],
    );
    for (const automation of automations) {
      // Fire and forget — don't block the caller
      runAutomation(automation, event).catch(err =>
        console.error(`[automation] ${automation.id} failed:`, err),
      );
    }
  } catch (err) {
    console.error('[automation] dispatchEvent error:', err);
  }
}

// ── Condition Evaluator ───────────────────────────────────────────────────────

function getFieldValue(event: AutomationEvent, field: string): string {
  const p = event.payload as Record<string, unknown>;
  if (field === 'title') return String(p.title ?? '');
  if (field === 'content') return String(p.content ?? '');
  if (field === 'created_by') return String(p.created_by ?? p.userId ?? '');
  if (field.startsWith('property.')) {
    const propName = field.slice('property.'.length);
    const props = (p.properties ?? {}) as Record<string, unknown>;
    return String(props[propName] ?? '');
  }
  return '';
}

function evaluateCondition(event: AutomationEvent, cond: Condition): boolean {
  const fieldVal = getFieldValue(event, cond.field).toLowerCase();
  const condVal = cond.value.toLowerCase();
  switch (cond.op) {
    case 'contains':     return fieldVal.includes(condVal);
    case 'not_contains': return !fieldVal.includes(condVal);
    case 'eq':           return fieldVal === condVal;
    case 'ne':           return fieldVal !== condVal;
    case 'gt':           return parseFloat(fieldVal) > parseFloat(condVal);
    case 'lt':           return parseFloat(fieldVal) < parseFloat(condVal);
    case 'starts_with':  return fieldVal.startsWith(condVal);
    case 'regex': {
      try { return new RegExp(cond.value, 'i').test(getFieldValue(event, cond.field)); }
      catch { return false; }
    }
    default: return true;
  }
}

function evaluateConditions(event: AutomationEvent, conditions: Condition[]): boolean {
  if (!conditions.length) return true;
  return conditions.every(c => evaluateCondition(event, c));
}

// ── Action Executors ──────────────────────────────────────────────────────────

async function executeAction(
  action: Action,
  event: AutomationEvent,
  automation: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  switch (action.type) {
    case 'run_agent': {
      // Call the supervisor agent pipeline
      const { startSupervisorRun } = await import('./agent.js');
      const config = action.config as { template?: string; query?: string };
      const query = config.query ?? String(event.payload.title ?? 'Analyze this document');
      const template = (config.template ?? 'supervisor') as 'supervisor' | 'research' | 'summarize' | 'brainstorm' | 'outline';
      const runId = crypto.randomUUID();
      await startSupervisorRun({
        runId,
        workspace_id: event.workspaceId,
        user_id: event.userId ?? String(automation.created_by ?? ''),
        query,
        template,
      });
      return { run_id: runId, status: 'running' };
    }

    case 'send_webhook': {
      const config = action.config as { url: string; secret?: string };
      const body = JSON.stringify({ automation_id: automation.id, event: event.type, payload: event.payload });
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (config.secret) {
        const crypto = await import('crypto');
        const sig = crypto.createHmac('sha256', config.secret).update(body).digest('hex');
        headers['X-Pegn-Signature'] = `sha256=${sig}`;
      }
      const resp = await fetch(config.url, { method: 'POST', headers, body });
      return { status: resp.status, ok: resp.ok };
    }

    case 'notify_user': {
      if (!pool) return { skipped: true };
      const config = action.config as { user_id?: string; message?: string };
      const targetUserId = config.user_id ?? event.userId;
      if (!targetUserId) return { skipped: true };
      await pool.query(
        `INSERT INTO inbox_notifications (workspace_id, user_id, type, title, body, metadata)
         VALUES ($1, $2, 'automation', $3, $4, $5)
         ON CONFLICT DO NOTHING`,
        [
          event.workspaceId, targetUserId,
          String(automation.name),
          config.message ?? `Automation "${automation.name}" was triggered`,
          JSON.stringify({ automation_id: automation.id, event: event.type }),
        ],
      );
      return { notified: targetUserId };
    }

    case 'create_document': {
      if (!pool) return { skipped: true };
      const config = action.config as { title?: string; template_id?: string; parent_id?: string };
      let content = '';
      if (config.template_id) {
        const { rows: [tmpl] } = await pool.query(
          `SELECT content FROM page_templates WHERE id = $1`, [config.template_id],
        );
        if (tmpl) content = tmpl.content;
      }
      const title = config.title ?? `New page from ${String(automation.name)}`;
      const { rows: [doc] } = await pool.query(
        `INSERT INTO documents (workspace_id, title, content, metadata)
         VALUES ($1, $2, $3, $4) RETURNING id, title`,
        [event.workspaceId, title, content, JSON.stringify({ parent_id: config.parent_id ?? null })],
      );
      return { created_document_id: doc.id };
    }

    case 'update_property': {
      if (!pool) return { skipped: true };
      const config = action.config as { collection_id: string; document_id?: string; property: string; value: unknown };
      const docId = config.document_id ?? String(event.payload.id ?? '');
      await pool.query(
        `UPDATE collection_items
         SET properties = jsonb_set(COALESCE(properties, '{}'), $1, $2::jsonb)
         WHERE collection_id = $3 AND document_id = $4`,
        [
          `{${config.property}}`,
          JSON.stringify(config.value),
          config.collection_id,
          docId,
        ],
      );
      return { updated: true };
    }

    default:
      return { skipped: true, reason: 'unknown action type' };
  }
}

// ── Main Runner ───────────────────────────────────────────────────────────────

export async function runAutomation(
  automation: Record<string, unknown>,
  event: AutomationEvent,
): Promise<void> {
  if (!pool) return;

  const conditions = (automation.conditions as Condition[]) ?? [];
  const actions = (automation.actions as Action[]) ?? [];

  // Check conditions
  if (!evaluateConditions(event, conditions)) {
    await pool.query(
      `INSERT INTO automation_runs (automation_id, workspace_id, trigger_event, status, finished_at)
       VALUES ($1, $2, $3, 'skipped', NOW())`,
      [automation.id, event.workspaceId, JSON.stringify(event)],
    );
    return;
  }

  // Create run record
  const { rows: [run] } = await pool.query(
    `INSERT INTO automation_runs (automation_id, workspace_id, trigger_event, status)
     VALUES ($1, $2, $3, 'running') RETURNING id`,
    [automation.id, event.workspaceId, JSON.stringify(event)],
  );

  const executedActions: Array<Record<string, unknown>> = [];
  let finalStatus: 'success' | 'failed' = 'success';
  let errorMsg: string | null = null;

  for (const action of actions) {
    try {
      const result = await executeAction(action, event, automation);
      executedActions.push({ type: action.type, result, ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      executedActions.push({ type: action.type, error: msg, ok: false });
      finalStatus = 'failed';
      errorMsg = msg;
      // Continue executing remaining actions
    }
  }

  // Update run record
  await pool.query(
    `UPDATE automation_runs
     SET status = $1, actions_executed = $2, error = $3, finished_at = NOW()
     WHERE id = $4`,
    [finalStatus, JSON.stringify(executedActions), errorMsg, run.id],
  );

  // Update automation stats
  await pool.query(
    `UPDATE automations
     SET run_count = run_count + 1, last_run_at = NOW(), last_error = $1
     WHERE id = $2`,
    [errorMsg, automation.id],
  );
}

// ── Cron Scheduler ────────────────────────────────────────────────────────────

let schedulerStarted = false;

export async function startScheduler(): Promise<void> {
  if (schedulerStarted) return;
  schedulerStarted = true;

  // Check for cron automations every minute
  setInterval(async () => {
    if (!pool) return;
    try {
      const now = new Date();
      const { rows: cronAutomations } = await pool.query(
        `SELECT * FROM automations WHERE trigger_type = 'schedule.cron' AND enabled = true`,
      );
      for (const automation of cronAutomations) {
        const config = automation.trigger_config as { cron_expr?: string };
        if (!config.cron_expr) continue;
        if (shouldRunCron(config.cron_expr, now)) {
          const event: AutomationEvent = {
            type: 'schedule.cron',
            workspaceId: automation.workspace_id,
            payload: { cron_expr: config.cron_expr, fired_at: now.toISOString() },
          };
          runAutomation(automation, event).catch(console.error);
        }
      }
    } catch (err) {
      console.error('[scheduler] error:', err);
    }
  }, 60_000); // every minute

  console.log('[automation] scheduler started');
}

/** Simple cron matcher — supports: * * * * * (min hour day month weekday) */
function shouldRunCron(expr: string, now: Date): boolean {
  const [min, hour, day, month, weekday] = expr.trim().split(/\s+/);
  const match = (field: string, val: number) =>
    field === '*' || parseInt(field, 10) === val;
  return (
    match(min,     now.getMinutes())  &&
    match(hour,    now.getHours())    &&
    match(day,     now.getDate())     &&
    match(month,   now.getMonth() + 1) &&
    match(weekday, now.getDay())
  );
}

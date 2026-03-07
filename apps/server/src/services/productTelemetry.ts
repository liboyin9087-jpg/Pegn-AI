import { pool } from '../db/client.js';

export type ProductTelemetryEventName =
  | 'search_performed'
  | 'search_no_result'
  | 'reindex_triggered'
  | 'agent_run_created'
  | 'agent_rerun_clicked'
  | 'job_retry_clicked'
  | 'alert_opened'
  | 'notification_opened';

export interface ProductTelemetryEventInput {
  eventName: ProductTelemetryEventName;
  workspaceId: string;
  userId: string;
  surface: 'search' | 'agent' | 'operations' | 'admin' | 'document' | 'inbox';
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
}

function sanitizeMetadata(metadata: Record<string, unknown> | undefined): Record<string, unknown> {
  if (!metadata) return {};
  const entries = Object.entries(metadata).filter(([, value]) => {
    if (typeof value === 'string') {
      return value.length <= 500;
    }
    return true;
  });
  return Object.fromEntries(entries);
}

export async function recordProductTelemetryEvent(input: ProductTelemetryEventInput): Promise<void> {
  if (!pool) return;

  await pool.query(
    `INSERT INTO product_telemetry_events
      (event_name, workspace_id, user_id, surface, target_type, target_id, metadata)
     VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      input.eventName,
      input.workspaceId,
      input.userId,
      input.surface,
      input.targetType ?? null,
      input.targetId ?? null,
      JSON.stringify(sanitizeMetadata(input.metadata)),
    ]
  );
}

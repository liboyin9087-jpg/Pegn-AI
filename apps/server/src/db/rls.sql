CREATE OR REPLACE FUNCTION app_current_user_id()
RETURNS UUID
LANGUAGE SQL
STABLE
AS $$
  SELECT NULLIF(current_setting('app.user_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_current_workspace_id()
RETURNS UUID
LANGUAGE SQL
STABLE
AS $$
  SELECT NULLIF(current_setting('app.workspace_id', true), '')::uuid
$$;

CREATE OR REPLACE FUNCTION app_bypass_rls()
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
AS $$
  SELECT COALESCE(NULLIF(current_setting('app.bypass_rls', true), ''), 'false') = 'true'
$$;

CREATE OR REPLACE FUNCTION app_is_workspace_member(candidate_workspace_id UUID, candidate_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    app_bypass_rls()
    OR EXISTS (
      SELECT 1
      FROM workspace_members m
      WHERE m.workspace_id = candidate_workspace_id
        AND m.user_id = candidate_user_id
    )
$$;

CREATE OR REPLACE FUNCTION app_has_document_access(candidate_document_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    app_bypass_rls()
    OR EXISTS (
      SELECT 1
      FROM documents d
      WHERE d.id = candidate_document_id
        AND app_is_workspace_member(d.workspace_id, app_current_user_id())
    )
$$;

CREATE OR REPLACE FUNCTION app_has_collection_access(candidate_collection_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    app_bypass_rls()
    OR EXISTS (
      SELECT 1
      FROM collections c
      WHERE c.id = candidate_collection_id
        AND app_is_workspace_member(c.workspace_id, app_current_user_id())
    )
$$;

CREATE OR REPLACE FUNCTION app_has_agent_run_access(candidate_run_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    app_bypass_rls()
    OR EXISTS (
      SELECT 1
      FROM agent_runs r
      WHERE r.id = candidate_run_id
        AND app_is_workspace_member(r.workspace_id, app_current_user_id())
    )
$$;

CREATE OR REPLACE FUNCTION app_has_comment_thread_access(candidate_thread_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    app_bypass_rls()
    OR EXISTS (
      SELECT 1
      FROM comment_threads t
      WHERE t.id = candidate_thread_id
        AND app_is_workspace_member(t.workspace_id, app_current_user_id())
    )
$$;

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS documents_workspace_access ON documents;
CREATE POLICY documents_workspace_access ON documents
  USING (app_is_workspace_member(workspace_id, app_current_user_id()))
  WITH CHECK (app_is_workspace_member(workspace_id, app_current_user_id()));

ALTER TABLE blocks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS blocks_document_access ON blocks;
CREATE POLICY blocks_document_access ON blocks
  USING (app_has_document_access(document_id))
  WITH CHECK (app_has_document_access(document_id));

ALTER TABLE document_snapshots ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS document_snapshots_document_access ON document_snapshots;
CREATE POLICY document_snapshots_document_access ON document_snapshots
  USING (app_has_document_access(document_id))
  WITH CHECK (app_has_document_access(document_id));

ALTER TABLE search_index ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS search_index_document_access ON search_index;
CREATE POLICY search_index_document_access ON search_index
  USING (app_has_document_access(document_id))
  WITH CHECK (app_has_document_access(document_id));

ALTER TABLE collections ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS collections_workspace_access ON collections;
CREATE POLICY collections_workspace_access ON collections
  USING (app_is_workspace_member(workspace_id, app_current_user_id()))
  WITH CHECK (app_is_workspace_member(workspace_id, app_current_user_id()));

ALTER TABLE collection_views ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS collection_views_collection_access ON collection_views;
CREATE POLICY collection_views_collection_access ON collection_views
  USING (app_has_collection_access(collection_id))
  WITH CHECK (app_has_collection_access(collection_id));

ALTER TABLE kg_entities ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kg_entities_workspace_access ON kg_entities;
CREATE POLICY kg_entities_workspace_access ON kg_entities
  USING (app_is_workspace_member(workspace_id, app_current_user_id()))
  WITH CHECK (app_is_workspace_member(workspace_id, app_current_user_id()));

ALTER TABLE kg_relationships ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS kg_relationships_workspace_access ON kg_relationships;
CREATE POLICY kg_relationships_workspace_access ON kg_relationships
  USING (app_is_workspace_member(workspace_id, app_current_user_id()))
  WITH CHECK (app_is_workspace_member(workspace_id, app_current_user_id()));

ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_runs_workspace_access ON agent_runs;
CREATE POLICY agent_runs_workspace_access ON agent_runs
  USING (app_is_workspace_member(workspace_id, app_current_user_id()))
  WITH CHECK (app_is_workspace_member(workspace_id, app_current_user_id()));

ALTER TABLE agent_steps ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_steps_run_access ON agent_steps;
CREATE POLICY agent_steps_run_access ON agent_steps
  USING (app_has_agent_run_access(run_id))
  WITH CHECK (app_has_agent_run_access(run_id));

ALTER TABLE agent_artifacts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS agent_artifacts_workspace_access ON agent_artifacts;
CREATE POLICY agent_artifacts_workspace_access ON agent_artifacts
  USING (app_is_workspace_member(workspace_id, app_current_user_id()))
  WITH CHECK (app_is_workspace_member(workspace_id, app_current_user_id()));

ALTER TABLE comment_threads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS comment_threads_workspace_access ON comment_threads;
CREATE POLICY comment_threads_workspace_access ON comment_threads
  USING (app_is_workspace_member(workspace_id, app_current_user_id()))
  WITH CHECK (app_is_workspace_member(workspace_id, app_current_user_id()));

ALTER TABLE comment_anchors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS comment_anchors_thread_access ON comment_anchors;
CREATE POLICY comment_anchors_thread_access ON comment_anchors
  USING (app_has_comment_thread_access(thread_id))
  WITH CHECK (app_has_comment_thread_access(thread_id));

ALTER TABLE comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS comments_thread_access ON comments;
CREATE POLICY comments_thread_access ON comments
  USING (app_has_comment_thread_access(thread_id))
  WITH CHECK (
    app_has_comment_thread_access(thread_id)
    AND (created_by = app_current_user_id() OR app_bypass_rls())
  );

ALTER TABLE inbox_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inbox_notifications_owner_access ON inbox_notifications;
CREATE POLICY inbox_notifications_owner_access ON inbox_notifications
  USING (
    app_is_workspace_member(workspace_id, app_current_user_id())
    AND (user_id = app_current_user_id() OR app_bypass_rls())
  )
  WITH CHECK (
    app_is_workspace_member(workspace_id, app_current_user_id())
    AND (user_id = app_current_user_id() OR app_bypass_rls())
  );

ALTER TABLE comment_mentions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS comment_mentions_owner_access ON comment_mentions;
CREATE POLICY comment_mentions_owner_access ON comment_mentions
  USING (
    app_bypass_rls()
    OR (
      mentioned_user_id = app_current_user_id()
      AND EXISTS (
        SELECT 1
        FROM comments c
        JOIN comment_threads t ON t.id = c.thread_id
        WHERE c.id = comment_id
          AND app_is_workspace_member(t.workspace_id, app_current_user_id())
      )
    )
  )
  WITH CHECK (
    app_bypass_rls()
    OR mentioned_user_id = app_current_user_id()
  );

ALTER TABLE api_idempotency_keys ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS api_idempotency_keys_owner_access ON api_idempotency_keys;
CREATE POLICY api_idempotency_keys_owner_access ON api_idempotency_keys
  USING (
    app_is_workspace_member(workspace_id, app_current_user_id())
    AND (user_id = app_current_user_id() OR app_bypass_rls())
  )
  WITH CHECK (
    app_is_workspace_member(workspace_id, app_current_user_id())
    AND (user_id = app_current_user_id() OR app_bypass_rls())
  );

ALTER TABLE webhook_subscriptions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS webhook_subscriptions_workspace_access ON webhook_subscriptions;
CREATE POLICY webhook_subscriptions_workspace_access ON webhook_subscriptions
  USING (app_is_workspace_member(workspace_id, app_current_user_id()))
  WITH CHECK (app_is_workspace_member(workspace_id, app_current_user_id()));

ALTER TABLE quota_limits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS quota_limits_workspace_access ON quota_limits;
CREATE POLICY quota_limits_workspace_access ON quota_limits
  USING (app_is_workspace_member(workspace_id, app_current_user_id()))
  WITH CHECK (app_is_workspace_member(workspace_id, app_current_user_id()));

ALTER TABLE usage_records ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS usage_records_workspace_access ON usage_records;
CREATE POLICY usage_records_workspace_access ON usage_records
  USING (app_is_workspace_member(workspace_id, app_current_user_id()))
  WITH CHECK (app_is_workspace_member(workspace_id, app_current_user_id()));

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_logs_workspace_access ON audit_logs;
CREATE POLICY audit_logs_workspace_access ON audit_logs
  USING (app_is_workspace_member(workspace_id, app_current_user_id()))
  WITH CHECK (app_is_workspace_member(workspace_id, app_current_user_id()));

ALTER TABLE product_telemetry_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS product_telemetry_workspace_access ON product_telemetry_events;
CREATE POLICY product_telemetry_workspace_access ON product_telemetry_events
  USING (app_is_workspace_member(workspace_id, app_current_user_id()))
  WITH CHECK (app_is_workspace_member(workspace_id, app_current_user_id()));

ALTER TABLE saved_views ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS saved_views_access ON saved_views;
CREATE POLICY saved_views_access ON saved_views
  USING (
    app_is_workspace_member(workspace_id, app_current_user_id())
    AND (
      scope = 'workspace'
      OR owner_user_id = app_current_user_id()
      OR app_bypass_rls()
    )
  )
  WITH CHECK (
    app_is_workspace_member(workspace_id, app_current_user_id())
    AND (
      scope = 'workspace'
      OR owner_user_id = app_current_user_id()
      OR app_bypass_rls()
    )
  );

ALTER TABLE collaboration_threads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS collaboration_threads_workspace_access ON collaboration_threads;
CREATE POLICY collaboration_threads_workspace_access ON collaboration_threads
  USING (app_is_workspace_member(workspace_id, app_current_user_id()))
  WITH CHECK (app_is_workspace_member(workspace_id, app_current_user_id()));

ALTER TABLE thread_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS thread_comments_workspace_access ON thread_comments;
CREATE POLICY thread_comments_workspace_access ON thread_comments
  USING (app_is_workspace_member(workspace_id, app_current_user_id()))
  WITH CHECK (app_is_workspace_member(workspace_id, app_current_user_id()));

ALTER TABLE thread_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS thread_assignments_workspace_access ON thread_assignments;
CREATE POLICY thread_assignments_workspace_access ON thread_assignments
  USING (app_is_workspace_member(workspace_id, app_current_user_id()))
  WITH CHECK (app_is_workspace_member(workspace_id, app_current_user_id()));

ALTER TABLE workflow_actions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workflow_actions_workspace_access ON workflow_actions;
CREATE POLICY workflow_actions_workspace_access ON workflow_actions
  USING (app_is_workspace_member(workspace_id, app_current_user_id()))
  WITH CHECK (app_is_workspace_member(workspace_id, app_current_user_id()));

ALTER TABLE workflow_approvals ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS workflow_approvals_workspace_access ON workflow_approvals;
CREATE POLICY workflow_approvals_workspace_access ON workflow_approvals
  USING (app_is_workspace_member(workspace_id, app_current_user_id()))
  WITH CHECK (app_is_workspace_member(workspace_id, app_current_user_id()));

ALTER TABLE automations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS automations_workspace_access ON automations;
CREATE POLICY automations_workspace_access ON automations
  USING (app_is_workspace_member(workspace_id, app_current_user_id()))
  WITH CHECK (app_is_workspace_member(workspace_id, app_current_user_id()));

ALTER TABLE automation_runs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS automation_runs_workspace_access ON automation_runs;
CREATE POLICY automation_runs_workspace_access ON automation_runs
  USING (app_is_workspace_member(workspace_id, app_current_user_id()))
  WITH CHECK (app_is_workspace_member(workspace_id, app_current_user_id()));

ALTER TABLE jobs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS jobs_workspace_access ON jobs;
CREATE POLICY jobs_workspace_access ON jobs
  USING (app_is_workspace_member(workspace_id, app_current_user_id()))
  WITH CHECK (app_is_workspace_member(workspace_id, app_current_user_id()));

ALTER TABLE job_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS job_events_job_access ON job_events;
CREATE POLICY job_events_job_access ON job_events
  USING (
    app_bypass_rls()
    OR EXISTS (
      SELECT 1
      FROM jobs j
      WHERE j.id = job_id
        AND app_is_workspace_member(j.workspace_id, app_current_user_id())
    )
  )
  WITH CHECK (
    app_bypass_rls()
    OR EXISTS (
      SELECT 1
      FROM jobs j
      WHERE j.id = job_id
        AND app_is_workspace_member(j.workspace_id, app_current_user_id())
    )
  );

ALTER TABLE automation_trigger_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS automation_trigger_events_workspace_access ON automation_trigger_events;
CREATE POLICY automation_trigger_events_workspace_access ON automation_trigger_events
  USING (app_is_workspace_member(workspace_id, app_current_user_id()))
  WITH CHECK (app_is_workspace_member(workspace_id, app_current_user_id()));

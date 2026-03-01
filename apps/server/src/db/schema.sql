-- AI-Native Work OS Database Schema
-- Phase 1: Core Platform & Data Layer

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- Auth: Users table
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT,
    name TEXT NOT NULL,
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- OAuth providers table (Google, GitHub, etc.)
CREATE TABLE IF NOT EXISTS oauth_providers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('google', 'github')),
    provider_id TEXT NOT NULL,
    access_token TEXT,
    refresh_token TEXT,
    avatar_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(provider, provider_id)
);
CREATE INDEX IF NOT EXISTS idx_oauth_user_id ON oauth_providers(user_id);
CREATE INDEX IF NOT EXISTS idx_oauth_provider ON oauth_providers(provider, provider_id);

-- Workspaces table
CREATE TABLE IF NOT EXISTS workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID,
    settings JSONB DEFAULT '{}'
);

-- Workspace Members (RBAC)
CREATE TABLE IF NOT EXISTS workspace_members (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(workspace_id, user_id)
);

-- Documents table
CREATE TABLE IF NOT EXISTS documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    content JSONB DEFAULT '{}',
    yjs_state BYTEA,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID,
    last_modified_by UUID,
    version INTEGER DEFAULT 1,
    metadata JSONB DEFAULT '{}'
);

-- Blocks table (for BlockSuite integration)
CREATE TABLE IF NOT EXISTS blocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    block_id TEXT NOT NULL, -- BlockSuite block ID
    block_type TEXT NOT NULL, -- text, heading, code, image, table, etc.
    content JSONB DEFAULT '{}',
    yjs_data BYTEA,
    parent_id UUID REFERENCES blocks(id),
    position INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(document_id, block_id)
);

-- Document snapshots for CRDT persistence
CREATE TABLE IF NOT EXISTS document_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    yjs_snapshot BYTEA NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    version INTEGER NOT NULL,
    metadata JSONB DEFAULT '{}'
);

-- Search index for BM25
CREATE TABLE IF NOT EXISTS search_index (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    block_id UUID REFERENCES blocks(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    content_vector vector(768), -- Gemini text-embedding-004 dimension
    title TEXT,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(document_id, block_id)
);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_documents_workspace_id ON documents(workspace_id);
CREATE INDEX IF NOT EXISTS idx_documents_updated_at ON documents(updated_at);
CREATE INDEX IF NOT EXISTS idx_blocks_document_id ON blocks(document_id);
CREATE INDEX IF NOT EXISTS idx_blocks_parent_id ON blocks(parent_id);
CREATE INDEX IF NOT EXISTS idx_blocks_block_type ON blocks(block_type);
CREATE INDEX IF NOT EXISTS idx_snapshots_document_id ON document_snapshots(document_id);
CREATE INDEX IF NOT EXISTS idx_snapshots_created_at ON document_snapshots(created_at);
CREATE INDEX IF NOT EXISTS idx_search_document_id ON search_index(document_id);
CREATE INDEX IF NOT EXISTS idx_search_block_id ON search_index(block_id);

-- Vector index for similarity search
CREATE INDEX IF NOT EXISTS idx_search_content_vector ON search_index USING ivfflat (content_vector vector_cosine_ops);

-- Full-text search index for BM25
CREATE INDEX IF NOT EXISTS idx_search_content_fts ON search_index USING gin(to_tsvector('english', content));

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Triggers for updated_at
DROP TRIGGER IF EXISTS update_workspaces_updated_at ON workspaces;
CREATE TRIGGER update_workspaces_updated_at BEFORE UPDATE ON workspaces FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_documents_updated_at ON documents;
CREATE TRIGGER update_documents_updated_at BEFORE UPDATE ON documents FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_blocks_updated_at ON blocks;
CREATE TRIGGER update_blocks_updated_at BEFORE UPDATE ON blocks FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_search_index_updated_at ON search_index;
CREATE TRIGGER update_search_index_updated_at BEFORE UPDATE ON search_index FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Phase 1.5: Multi-View Database (Collections)
-- ============================================================

-- Collections (Databases)
CREATE TABLE IF NOT EXISTS collections (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    icon TEXT,
    schema JSONB DEFAULT '{"properties": {}}'::jsonb, -- Defines the columns/properties (e.g. status, tags, date)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    created_by UUID REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS idx_collections_workspace_id ON collections(workspace_id);
DROP TRIGGER IF EXISTS update_collections_updated_at ON collections;
CREATE TRIGGER update_collections_updated_at BEFORE UPDATE ON collections FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Collection Views (Table, Kanban, Calendar, etc.)
CREATE TABLE IF NOT EXISTS collection_views (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    collection_id UUID NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('table', 'board', 'calendar', 'gallery', 'list')),
    configuration JSONB DEFAULT '{}'::jsonb, -- Stores sort, filter, group_by, visible_properties
    position INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_collection_views_collection_id ON collection_views(collection_id);
DROP TRIGGER IF EXISTS update_collection_views_updated_at ON collection_views;
CREATE TRIGGER update_collection_views_updated_at BEFORE UPDATE ON collection_views FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Link Documents to Collections (A document acts as a "row" or "page" in a collection)
ALTER TABLE documents 
ADD COLUMN IF NOT EXISTS collection_id UUID REFERENCES collections(id) ON DELETE SET NULL,
ADD COLUMN IF NOT EXISTS properties JSONB DEFAULT '{}'::jsonb; -- Stores the actual values for the schema properties

CREATE INDEX IF NOT EXISTS idx_documents_collection_id ON documents(collection_id);

-- ============================================================
-- Phase 2 M8: Knowledge Graph Schema
-- ============================================================

-- KG Entities table
CREATE TABLE IF NOT EXISTS kg_entities (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    document_id UUID REFERENCES documents(id) ON DELETE SET NULL,
    block_id UUID REFERENCES blocks(id) ON DELETE SET NULL,
    name TEXT NOT NULL,
    entity_type TEXT NOT NULL, -- person, place, concept, org, event, etc.
    description TEXT,
    embedding vector(768),
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- KG Relationships table
CREATE TABLE IF NOT EXISTS kg_relationships (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    source_entity_id UUID NOT NULL REFERENCES kg_entities(id) ON DELETE CASCADE,
    target_entity_id UUID NOT NULL REFERENCES kg_entities(id) ON DELETE CASCADE,
    relation_type TEXT NOT NULL, -- relates_to, causes, part_of, mentions, etc.
    weight DECIMAL(4,3) DEFAULT 1.0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for KG
CREATE INDEX IF NOT EXISTS idx_kg_entities_workspace ON kg_entities(workspace_id);
CREATE INDEX IF NOT EXISTS idx_kg_entities_type ON kg_entities(entity_type);
CREATE INDEX IF NOT EXISTS idx_kg_entities_name ON kg_entities(name);
CREATE INDEX IF NOT EXISTS idx_kg_entities_embedding ON kg_entities USING ivfflat (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_kg_relationships_source ON kg_relationships(source_entity_id);
CREATE INDEX IF NOT EXISTS idx_kg_relationships_target ON kg_relationships(target_entity_id);
CREATE INDEX IF NOT EXISTS idx_kg_relationships_type ON kg_relationships(relation_type);
CREATE INDEX IF NOT EXISTS idx_kg_relationships_workspace ON kg_relationships(workspace_id);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_kg_relationships_pair
ON kg_relationships(workspace_id, source_entity_id, target_entity_id, relation_type);

-- ============================================================
-- Phase 7: RBAC 權限管理系統
-- ============================================================

-- Roles table
CREATE TABLE IF NOT EXISTS roles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES workspaces(id) ON DELETE CASCADE, -- NULL for global/default roles
    name TEXT NOT NULL,
    description TEXT,
    permissions JSONB DEFAULT '[]'::jsonb, -- e.g., ["workspace:admin", "collection:create", "collection:edit", "collection:view"]
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(workspace_id, name)
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_global_roles_name ON roles(name) WHERE workspace_id IS NULL;

-- Update workspace_members to support role_id
-- We keep 'role' for backward compatibility during migration, but will transition to role_id
ALTER TABLE workspace_members ADD COLUMN IF NOT EXISTS role_id UUID REFERENCES roles(id) ON DELETE SET NULL;

-- Initial System Roles
-- Note: These would normally be inserted via a migration or seed script, 
-- but we include a comment here for schema completeness.
/*
INSERT INTO roles (name, description, permissions) VALUES 
('admin', 'Full access to the workspace and members', '["workspace:admin", "collection:create", "collection:edit", "collection:delete", "collection:view"]'),
('editor', 'Can create and edit content', '["collection:create", "collection:edit", "collection:view"]'),
('viewer', 'Read-only access', '["collection:view"]');
*/

DROP TRIGGER IF EXISTS update_roles_updated_at ON roles;
CREATE TRIGGER update_roles_updated_at BEFORE UPDATE ON roles FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Phase 2: Workspace Invites
-- ============================================================

CREATE TABLE IF NOT EXISTS workspace_invites (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('admin', 'editor', 'viewer')),
    token_hash TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'revoked', 'expired')) DEFAULT 'pending',
    invited_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    accepted_by UUID REFERENCES users(id) ON DELETE SET NULL,
    expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    accepted_at TIMESTAMP WITH TIME ZONE,
    revoked_at TIMESTAMP WITH TIME ZONE
);

CREATE INDEX IF NOT EXISTS idx_workspace_invites_workspace ON workspace_invites(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_invites_email ON workspace_invites(email);
CREATE INDEX IF NOT EXISTS idx_workspace_invites_status ON workspace_invites(status);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_workspace_invites_token_hash ON workspace_invites(token_hash);
DROP TRIGGER IF EXISTS update_workspace_invites_updated_at ON workspace_invites;
CREATE TRIGGER update_workspace_invites_updated_at BEFORE UPDATE ON workspace_invites FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Phase 2: Supervisor Agent Runs
-- ============================================================

CREATE TABLE IF NOT EXISTS agent_runs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL DEFAULT 'supervisor',
    query TEXT NOT NULL,
    mode TEXT NOT NULL DEFAULT 'auto',
    status TEXT NOT NULL CHECK (status IN ('running', 'done', 'error', 'aborted')) DEFAULT 'running',
    result JSONB DEFAULT '{}'::jsonb,
    error TEXT,
    token_usage INTEGER DEFAULT 0,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    finished_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS agent_steps (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    run_id UUID NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
    step_key TEXT NOT NULL,
    name TEXT NOT NULL,
    worker TEXT NOT NULL,
    position INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'done', 'error', 'aborted')) DEFAULT 'pending',
    input JSONB DEFAULT '{}'::jsonb,
    output JSONB DEFAULT '{}'::jsonb,
    error TEXT,
    token_usage INTEGER DEFAULT 0,
    started_at TIMESTAMP WITH TIME ZONE,
    finished_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(run_id, step_key)
);

CREATE INDEX IF NOT EXISTS idx_agent_runs_workspace ON agent_runs(workspace_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_user ON agent_runs(user_id);
CREATE INDEX IF NOT EXISTS idx_agent_runs_status ON agent_runs(status);
CREATE INDEX IF NOT EXISTS idx_agent_steps_run ON agent_steps(run_id);
CREATE INDEX IF NOT EXISTS idx_agent_steps_status ON agent_steps(status);
DROP TRIGGER IF EXISTS update_agent_runs_updated_at ON agent_runs;
CREATE TRIGGER update_agent_runs_updated_at BEFORE UPDATE ON agent_runs FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_agent_steps_updated_at ON agent_steps;
CREATE TRIGGER update_agent_steps_updated_at BEFORE UPDATE ON agent_steps FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Phase 2: Comments / Mentions / Inbox
-- ============================================================

CREATE TABLE IF NOT EXISTS comment_threads (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    document_id UUID NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    status TEXT NOT NULL CHECK (status IN ('open', 'resolved')) DEFAULT 'open',
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    resolved_by UUID REFERENCES users(id) ON DELETE SET NULL,
    resolved_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comment_anchors (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id UUID NOT NULL UNIQUE REFERENCES comment_threads(id) ON DELETE CASCADE,
    block_id TEXT,
    start_offset INTEGER NOT NULL DEFAULT 0,
    end_offset INTEGER NOT NULL DEFAULT 0,
    yjs_relative_start TEXT,
    yjs_relative_end TEXT,
    selected_text TEXT,
    context_before TEXT,
    context_after TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id UUID NOT NULL REFERENCES comment_threads(id) ON DELETE CASCADE,
    parent_comment_id UUID REFERENCES comments(id) ON DELETE CASCADE,
    body_markdown TEXT NOT NULL,
    created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    edited_at TIMESTAMP WITH TIME ZONE,
    deleted_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inbox_notifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type TEXT NOT NULL CHECK (type IN ('mention')),
    payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    status TEXT NOT NULL CHECK (status IN ('unread', 'read')) DEFAULT 'unread',
    read_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS comment_mentions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    comment_id UUID NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
    mentioned_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    notification_id UUID REFERENCES inbox_notifications(id) ON DELETE SET NULL,
    status TEXT NOT NULL CHECK (status IN ('unread', 'read')) DEFAULT 'unread',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(comment_id, mentioned_user_id)
);

CREATE INDEX IF NOT EXISTS idx_comment_threads_workspace ON comment_threads(workspace_id);
CREATE INDEX IF NOT EXISTS idx_comment_threads_document ON comment_threads(document_id);
CREATE INDEX IF NOT EXISTS idx_comment_threads_status ON comment_threads(status);
CREATE INDEX IF NOT EXISTS idx_comments_thread ON comments(thread_id);
CREATE INDEX IF NOT EXISTS idx_comments_parent ON comments(parent_comment_id);
CREATE INDEX IF NOT EXISTS idx_comment_mentions_comment ON comment_mentions(comment_id);
CREATE INDEX IF NOT EXISTS idx_comment_mentions_user ON comment_mentions(mentioned_user_id);
CREATE INDEX IF NOT EXISTS idx_inbox_notifications_user ON inbox_notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_inbox_notifications_workspace ON inbox_notifications(workspace_id);
CREATE INDEX IF NOT EXISTS idx_inbox_notifications_status ON inbox_notifications(status);
DROP TRIGGER IF EXISTS update_comment_threads_updated_at ON comment_threads;
CREATE TRIGGER update_comment_threads_updated_at BEFORE UPDATE ON comment_threads FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_comment_anchors_updated_at ON comment_anchors;
CREATE TRIGGER update_comment_anchors_updated_at BEFORE UPDATE ON comment_anchors FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_comments_updated_at ON comments;
CREATE TRIGGER update_comments_updated_at BEFORE UPDATE ON comments FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_comment_mentions_updated_at ON comment_mentions;
CREATE TRIGGER update_comment_mentions_updated_at BEFORE UPDATE ON comment_mentions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_inbox_notifications_updated_at ON inbox_notifications;
CREATE TRIGGER update_inbox_notifications_updated_at BEFORE UPDATE ON inbox_notifications FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Phase 2: Idempotency Keys (offline mutation replay)
-- ============================================================

CREATE TABLE IF NOT EXISTS api_idempotency_keys (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    operation TEXT NOT NULL,
    idempotency_key TEXT NOT NULL,
    status_code INTEGER NOT NULL,
    response JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(user_id, workspace_id, operation, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_idempotency_user_workspace ON api_idempotency_keys(user_id, workspace_id, operation);

-- ============================================================
-- Webhook Subscriptions (DB-persisted)
-- ============================================================

CREATE TABLE IF NOT EXISTS webhook_subscriptions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    events TEXT[] NOT NULL DEFAULT '{}',
    secret TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_workspace ON webhook_subscriptions(workspace_id);
CREATE INDEX IF NOT EXISTS idx_webhook_subscriptions_user ON webhook_subscriptions(user_id);
DROP TRIGGER IF EXISTS update_webhook_subscriptions_updated_at ON webhook_subscriptions;
CREATE TRIGGER update_webhook_subscriptions_updated_at BEFORE UPDATE ON webhook_subscriptions FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================================
-- Phase 2: Billing & Quota
-- ============================================================

-- Per-workspace quota limits (tokens/month, AI calls/day, etc.)
CREATE TABLE IF NOT EXISTS quota_limits (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
    plan TEXT NOT NULL DEFAULT 'free',              -- free | pro | enterprise
    ai_tokens_per_month INTEGER NOT NULL DEFAULT 100000,
    ai_calls_per_day INTEGER NOT NULL DEFAULT 200,
    agent_runs_per_day INTEGER NOT NULL DEFAULT 20,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Usage records keyed by (workspace, resource_type, period)
CREATE TABLE IF NOT EXISTS usage_records (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    resource_type TEXT NOT NULL,   -- ai_tokens | ai_calls | agent_runs
    period TEXT NOT NULL,          -- YYYY-MM-DD (day) or YYYY-MM (month)
    amount INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    UNIQUE(workspace_id, resource_type, period)
);

CREATE INDEX IF NOT EXISTS idx_quota_limits_workspace ON quota_limits(workspace_id);
CREATE INDEX IF NOT EXISTS idx_usage_records_workspace_period ON usage_records(workspace_id, resource_type, period);
DROP TRIGGER IF EXISTS update_quota_limits_updated_at ON quota_limits;
CREATE TRIGGER update_quota_limits_updated_at BEFORE UPDATE ON quota_limits FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
DROP TRIGGER IF EXISTS update_usage_records_updated_at ON usage_records;
CREATE TRIGGER update_usage_records_updated_at BEFORE UPDATE ON usage_records FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();


-- ============================================================
-- Phase 4: Document position for sidebar ordering
-- ============================================================
ALTER TABLE documents ADD COLUMN IF NOT EXISTS position FLOAT DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_documents_workspace_position ON documents(workspace_id, position);

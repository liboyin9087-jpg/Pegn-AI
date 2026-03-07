import React, { useCallback, useEffect, useState } from 'react';
import {
  addThreadComment,
  assignThread,
  createOrGetThread,
  getThreadDetail,
  listThreads,
  listWorkspaceMembers,
  reopenThread,
  resolveThread,
  type CollaborationTargetType,
  type CollaborationThread,
  type WorkspaceMemberRecord,
} from '../api/client';
import { useOptionalAppContext, useWorkspacePermissions } from '../contexts/AppContext';
import EmptyState from './EmptyState';
import ForbiddenState from './ForbiddenState';
import InlineRetryState from './InlineRetryState';
import LoadingSkeleton from './LoadingSkeleton';
import ThreadAssignmentBar from './ThreadAssignmentBar';
import ThreadCommentList from './ThreadCommentList';
import ThreadComposer from './ThreadComposer';
import ThreadStatusBar from './ThreadStatusBar';

export default function ThreadPanel({
  workspaceId,
  targetType,
  targetId,
  title,
  onOpenSurfaceTarget,
}: {
  workspaceId: string;
  targetType: CollaborationTargetType;
  targetId: string;
  title?: string;
  onOpenSurfaceTarget?: (target: NonNullable<CollaborationThread['sourceTarget']>) => void;
}) {
  const permissions = useWorkspacePermissions();
  const appContext = useOptionalAppContext();
  const [thread, setThread] = useState<CollaborationThread | null>(null);
  const [members, setMembers] = useState<WorkspaceMemberRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hasExistingThread, setHasExistingThread] = useState(true);

  const loadThread = useCallback(async () => {
    if (!workspaceId || !targetId) return;
    if (!permissions.canViewWorkspace) return;

    setLoading(true);
    setError(null);
    try {
      let nextThread: CollaborationThread | null = null;
      if (permissions.canCollaborate) {
        nextThread = await createOrGetThread({
          workspaceId,
          targetType,
          targetId,
          title: title ?? null,
        });
        setHasExistingThread(true);
      } else {
        const listResponse = await listThreads({
          workspaceId,
          targetType,
          targetId,
          limit: 1,
        });
        const existing = listResponse.items[0] ?? null;
        if (existing) {
          nextThread = await getThreadDetail(existing.threadId);
          setHasExistingThread(true);
        } else {
          setThread(null);
          setHasExistingThread(false);
        }
      }

      if (nextThread) {
        setThread(nextThread);
      }

      if (permissions.canCollaborate || permissions.canManageAssignments) {
        const memberResponse = await listWorkspaceMembers(workspaceId);
        setMembers(memberResponse.members);
      } else {
        setMembers([]);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [
    permissions.canCollaborate,
    permissions.canManageAssignments,
    permissions.canViewWorkspace,
    targetId,
    targetType,
    title,
    workspaceId,
  ]);

  useEffect(() => {
    void loadThread();
  }, [loadThread]);

  if (!permissions.canViewWorkspace) {
    return (
      <ForbiddenState
        title="Thread access unavailable"
        description="You do not have permission to inspect collaboration threads in this workspace."
      />
    );
  }

  if (loading) {
    return <LoadingSkeleton lines={4} />;
  }

  if (error) {
    return (
      <InlineRetryState
        title="Failed to load thread"
        description={error}
        onRetry={() => {
          void loadThread();
        }}
      />
    );
  }

  if (!thread) {
    return (
      <EmptyState
        title="No thread yet"
        description={hasExistingThread
          ? 'This thread is temporarily unavailable.'
          : permissions.canCollaborate
            ? 'Open the discussion again to create the canonical thread.'
            : 'No thread exists for this target yet. Editors and admins can create one by starting the discussion.'}
      />
    );
  }

  return (
    <div className="space-y-3">
      <ThreadStatusBar
        thread={thread}
        canCollaborate={permissions.canCollaborate}
        onResolve={() => {
          void resolveThread(thread.threadId).then(loadThread);
        }}
        onReopen={() => {
          void reopenThread(thread.threadId).then(loadThread);
        }}
        onOpenSource={onOpenSurfaceTarget ? () => onOpenSurfaceTarget(thread.sourceTarget) : undefined}
      />

      <ThreadAssignmentBar
        currentAssignment={thread.currentAssignment}
        members={members}
        canManageAssignments={permissions.canManageAssignments}
        onAssign={async (payload) => {
          await assignThread(thread.threadId, payload);
          appContext?.requestRefresh(['inbox']);
          await loadThread();
        }}
      />

      <ThreadCommentList comments={thread.comments} />

      <ThreadComposer
        canCollaborate={permissions.canCollaborate}
        members={members}
        onSubmit={async (payload) => {
          await addThreadComment(thread.threadId, payload);
          appContext?.requestRefresh(['inbox']);
          await loadThread();
        }}
      />
    </div>
  );
}

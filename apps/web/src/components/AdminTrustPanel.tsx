import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getWorkspaceAdminAlerts,
  getWorkspaceAdminSummary,
  getWorkspaceUsage,
  listWorkspaceAuditLogs,
  trackProductEvent,
  type AdminAlert,
  type AdminSummary,
  type AuditLogItem,
  type SurfaceLinkTarget,
  type UsageSummary,
} from '../api/client';
import { useOptionalAppContext, useRefreshVersion, useWorkspacePermissions } from '../contexts/AppContext';
import ForbiddenState from './ForbiddenState';
import ErrorState from './ErrorState';
import LoadingSkeleton from './LoadingSkeleton';
import AdminSummaryPanel from './AdminSummaryPanel';
import UsageQuotaPanel from './UsageQuotaPanel';
import AuditLogList from './AuditLogList';
import AdminAlertsPanel from './AdminAlertsPanel';

export default function AdminTrustPanel({
  workspaceId,
  onOpenOperations,
  onOpenSearch,
  navigationTarget,
  onOpenSurfaceTarget,
}: {
  workspaceId: string;
  onOpenOperations: () => void;
  onOpenSearch: () => void;
  navigationTarget?: SurfaceLinkTarget | null;
  onOpenSurfaceTarget?: (target: SurfaceLinkTarget) => void;
}) {
  const permissions = useWorkspacePermissions();
  const appContext = useOptionalAppContext();
  const adminRefreshVersion = useRefreshVersion('admin');
  const auditRefreshVersion = useRefreshVersion('audit');
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [alerts, setAlerts] = useState<AdminAlert[]>([]);
  const [auditItems, setAuditItems] = useState<AuditLogItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [usageHighlighted, setUsageHighlighted] = useState(false);
  const usageRef = useRef<HTMLDivElement | null>(null);

  const loadAdminSurface = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [summaryResponse, usageResponse, alertsResponse, auditResponse] = await Promise.all([
        getWorkspaceAdminSummary(workspaceId),
        getWorkspaceUsage(workspaceId),
        getWorkspaceAdminAlerts(workspaceId),
        listWorkspaceAuditLogs(workspaceId, { limit: 10 }),
      ]);
      setSummary(summaryResponse);
      setUsage(usageResponse);
      setAlerts(alertsResponse.items);
      setAuditItems(auditResponse.items);
      setNextCursor(auditResponse.nextCursor);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!permissions.canManageSettings) return;
    void loadAdminSurface();
  }, [auditRefreshVersion, adminRefreshVersion, loadAdminSurface, permissions.canManageSettings]);

  const handleLoadMore = useCallback(async () => {
    if (!nextCursor) return;
    const response = await listWorkspaceAuditLogs(workspaceId, { cursor: nextCursor, limit: 10 });
    setAuditItems((current) => [...current, ...response.items]);
    setNextCursor(response.nextCursor);
  }, [nextCursor, workspaceId]);

  const handleFocusUsage = useCallback(() => {
    setUsageHighlighted(true);
    usageRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    window.setTimeout(() => setUsageHighlighted(false), 1600);
  }, []);

  useEffect(() => {
    if (!navigationTarget || navigationTarget.surface !== 'admin') return;
    const section = navigationTarget.payload.section ?? navigationTarget.context?.section;
    if (section === 'usage') {
      handleFocusUsage();
    }
  }, [handleFocusUsage, navigationTarget]);

  const content = useMemo(() => {
    if (!permissions.canManageSettings) {
      return (
        <ForbiddenState
          title="Admin access required"
          description="Only workspace admins can view usage, audit, and trust controls."
        />
      );
    }
    if (loading) return <LoadingSkeleton lines={6} />;
    if (error) return <ErrorState title="Failed to load admin surface" description={error} />;
    if (!summary || !usage) return null;

    return (
      <div className="space-y-3">
        <AdminSummaryPanel summary={summary} />
        <div ref={usageRef}>
          <UsageQuotaPanel usage={usage} highlighted={usageHighlighted} />
        </div>
        <AdminAlertsPanel
          items={alerts}
          onOpenTarget={(target) => {
            if (workspaceId && appContext?.user?.id && onOpenSurfaceTarget && target.surface !== 'admin') {
              const targetId =
                'jobId' in target.payload ? target.payload.jobId :
                'runId' in target.payload ? target.payload.runId :
                'documentId' in target.payload ? target.payload.documentId :
                'section' in target.payload ? target.payload.section :
                null;
              void trackProductEvent('alert_opened', {
                workspaceId,
                userId: appContext.user.id,
                surface: 'admin',
                targetType: target.surface,
                targetId: targetId ?? null,
              }).catch(() => undefined);
            }
            if (target.surface === 'operations') {
              onOpenOperations();
              onOpenSurfaceTarget?.(target);
              return;
            }
            if (target.surface === 'search') {
              onOpenSearch();
              onOpenSurfaceTarget?.(target);
              return;
            }
            if (target.surface === 'admin' && target.payload.section === 'usage') {
              handleFocusUsage();
              return;
            }
            onOpenSurfaceTarget?.(target);
          }}
        />
        <AuditLogList items={auditItems} hasMore={Boolean(nextCursor)} onLoadMore={() => { void handleLoadMore(); }} />
      </div>
    );
  }, [alerts, appContext?.user?.id, auditItems, error, handleFocusUsage, handleLoadMore, loading, nextCursor, onOpenOperations, onOpenSearch, onOpenSurfaceTarget, permissions.canManageSettings, summary, usage, usageHighlighted, workspaceId]);

  return <div className="space-y-3 bg-surface p-3">{content}</div>;
}

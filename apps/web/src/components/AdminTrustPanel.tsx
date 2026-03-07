import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getWorkspaceAdminAlerts,
  getWorkspaceAdminSummary,
  getWorkspaceUsage,
  listWorkspaceAuditLogs,
  type AdminAlert,
  type AdminSummary,
  type AuditLogItem,
  type UsageSummary,
} from '../api/client';
import { useWorkspacePermissions } from '../contexts/AppContext';
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
}: {
  workspaceId: string;
  onOpenOperations: () => void;
  onOpenSearch: () => void;
}) {
  const permissions = useWorkspacePermissions();
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
  }, [loadAdminSurface, permissions.canManageSettings]);

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
          onOpenOperations={onOpenOperations}
          onOpenSearch={onOpenSearch}
          onFocusUsage={handleFocusUsage}
        />
        <AuditLogList items={auditItems} hasMore={Boolean(nextCursor)} onLoadMore={() => { void handleLoadMore(); }} />
      </div>
    );
  }, [alerts, auditItems, error, handleFocusUsage, handleLoadMore, loading, nextCursor, onOpenOperations, onOpenSearch, permissions.canManageSettings, summary, usage, usageHighlighted]);

  return <div className="space-y-3 bg-surface p-3">{content}</div>;
}

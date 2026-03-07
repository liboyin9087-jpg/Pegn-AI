import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Search as SearchIcon } from 'lucide-react';
import {
  getSearchIndexStatus,
  reindexSearchDocument,
  search,
  trackProductEvent,
  type SearchIndexStatusResponse,
  type SearchResponse,
  type SurfaceLinkTarget,
} from '../api/client';
import { useOptionalAppContext, useRefreshVersion, useWorkspacePermissions } from '../contexts/AppContext';
import SearchEmptyState from './SearchEmptyState';
import SearchFilterBar, { type SearchTimePreset } from './SearchFilterBar';
import SearchResultCard from './SearchResultCard';

interface Props {
  workspaceId: string;
  onNavigateDoc?: (docId: string) => void;
  onOpenOperations?: () => void;
  navigationTarget?: SurfaceLinkTarget | null;
  onOpenSurfaceTarget?: (target: SurfaceLinkTarget) => void;
}

function getUpdatedFrom(preset: SearchTimePreset): string | undefined {
  if (preset === 'all') return undefined;
  const now = new Date();
  const days = preset === '7d' ? 7 : 30;
  now.setDate(now.getDate() - days);
  return now.toISOString();
}

export default function SearchPanel({
  workspaceId,
  onNavigateDoc,
  onOpenOperations,
  navigationTarget,
  onOpenSurfaceTarget,
}: Props) {
  const permissions = useWorkspacePermissions();
  const appContext = useOptionalAppContext();
  const refreshVersion = useRefreshVersion('search');
  const savedContext = appContext?.surfaceContexts.search;
  const [draftQuery, setDraftQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [sourceFilter, setSourceFilter] = useState('');
  const [timePreset, setTimePreset] = useState<SearchTimePreset>('all');
  const [response, setResponse] = useState<SearchResponse | null>(null);
  const [results, setResults] = useState<SearchResponse['items']>([]);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [cursor, setCursor] = useState<string | null>(null);
  const [searchNonce, setSearchNonce] = useState(0);
  const [indexStatus, setIndexStatus] = useState<SearchIndexStatusResponse | null>(null);
  const [reindexingDocId, setReindexingDocId] = useState<string | null>(null);

  const refreshIndexStatus = useCallback(async () => {
    if (!workspaceId) return;
    try {
      setIndexStatus(await getSearchIndexStatus(workspaceId));
    } catch {
      setIndexStatus(null);
    }
  }, [workspaceId]);

  useEffect(() => {
    void refreshIndexStatus();
  }, [refreshIndexStatus]);

  const runSearch = useCallback(
    async (nextCursor?: string | null) => {
      if (!submittedQuery.trim()) return;

      if (nextCursor) setLoadingMore(true);
      else setLoading(true);

      try {
        const nextResponse = await search({
          workspaceId,
          q: submittedQuery,
          type: typeFilter || undefined,
          source: sourceFilter || undefined,
          updatedFrom: getUpdatedFrom(timePreset),
          limit: 10,
          cursor: nextCursor || undefined,
        });
        setResponse(nextResponse);
        setResults((prev) => (nextCursor ? [...prev, ...nextResponse.items] : nextResponse.items));
        if (!nextCursor && appContext?.user?.id) {
          void trackProductEvent('search_performed', {
            workspaceId,
            userId: appContext.user.id,
            surface: 'search',
            targetType: 'query',
            targetId: submittedQuery,
            metadata: {
              normalizedQuery: nextResponse.normalizedQuery,
              total: nextResponse.total,
              hasFilters: Boolean(typeFilter || sourceFilter || timePreset !== 'all'),
            },
          }).catch(() => undefined);
          if (nextResponse.total === 0) {
            void trackProductEvent('search_no_result', {
              workspaceId,
              userId: appContext.user.id,
              surface: 'search',
              targetType: 'query',
              targetId: submittedQuery,
              metadata: {
                normalizedQuery: nextResponse.normalizedQuery,
              },
            }).catch(() => undefined);
          }
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [appContext?.user?.id, sourceFilter, submittedQuery, timePreset, typeFilter, workspaceId]
  );

  useEffect(() => {
    if (!submittedQuery.trim()) {
      setResponse(null);
      setResults([]);
      return;
    }
    void runSearch(cursor);
  }, [cursor, refreshVersion, runSearch, searchNonce, submittedQuery]);

  useEffect(() => {
    if (!navigationTarget || navigationTarget.surface !== 'search') return;
    const nextQuery = navigationTarget.payload.query ?? navigationTarget.context?.query ?? '';
    if (nextQuery) {
      setDraftQuery(nextQuery);
      setSubmittedQuery(nextQuery);
      setCursor(null);
      setSearchNonce((current) => current + 1);
    }
  }, [navigationTarget]);

  useEffect(() => {
    if (!savedContext) return;
    setDraftQuery(savedContext.query ?? '');
    setSubmittedQuery(savedContext.query ?? '');
    setTypeFilter(savedContext.type ?? '');
    setSourceFilter(savedContext.source ?? '');
    setTimePreset(savedContext.updatedRange ?? 'all');
    setCursor(null);
  }, [savedContext]);

  useEffect(() => {
    appContext?.setSurfaceContext('search', {
      query: submittedQuery,
      type: typeFilter || null,
      source: sourceFilter || null,
      updatedRange: timePreset,
      staleOnly: false,
      selectedDocumentId: null,
      selectedTraceJobId: null,
    });
  }, [appContext, sourceFilter, submittedQuery, timePreset, typeFilter]);

  const submitSearch = useCallback(() => {
    const next = draftQuery.trim();
    setCursor(null);
    setSubmittedQuery(next);
    setSearchNonce((current) => current + 1);
  }, [draftQuery]);

  const handleClearFilters = useCallback(() => {
    setTypeFilter('');
    setSourceFilter('');
    setTimePreset('all');
    setCursor(null);
  }, []);

  const handleReindex = useCallback(
    async (documentId: string) => {
      setReindexingDocId(documentId);
      try {
        const reindexResponse = await reindexSearchDocument(documentId);
        if (workspaceId && appContext?.user?.id) {
          void trackProductEvent('reindex_triggered', {
            workspaceId,
            userId: appContext.user.id,
            surface: 'search',
            targetType: 'document',
            targetId: documentId,
            metadata: {
              jobId: reindexResponse.jobId,
            },
          }).catch(() => undefined);
        }
        appContext?.requestRefresh(['search', 'jobs', 'admin', 'audit', 'inbox']);
        await Promise.all([runSearch(null), refreshIndexStatus()]);
        if (reindexResponse.jobId && onOpenSurfaceTarget) {
          onOpenSurfaceTarget({
            surface: 'operations',
            payload: {
              jobId: reindexResponse.jobId,
              jobType: 'document_reindex',
              resourceType: 'document',
              resourceId: documentId,
            },
            context: { filter: 'document_reindex' },
          });
        } else {
          onOpenOperations?.();
        }
      } finally {
        setReindexingDocId(null);
      }
    },
    [appContext, onOpenOperations, onOpenSurfaceTarget, refreshIndexStatus, runSearch, workspaceId]
  );

  const filtersAppliedText = useMemo(() => {
    if (!response) return null;
    const parts = [
      response.filtersApplied.type ? `type: ${response.filtersApplied.type}` : null,
      response.filtersApplied.source ? `source: ${response.filtersApplied.source}` : null,
      response.filtersApplied.updatedFrom ? `updated from: ${new Date(response.filtersApplied.updatedFrom).toLocaleDateString()}` : null,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' / ') : 'No filters applied';
  }, [response]);

  const hasSearched = submittedQuery.trim().length > 0;

  return (
    <div className="flex h-full flex-col bg-surface">
      <div className="flex-shrink-0 border-b border-border p-4">
        <div className="flex gap-2">
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-text-tertiary" size={14} />
            <input
              value={draftQuery}
              onChange={(event) => setDraftQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitSearch();
              }}
              placeholder="Search documents, titles, sources, and indexed content"
              className="w-full rounded-xl border border-border bg-panel py-2.5 pl-9 pr-3 text-sm text-text-primary outline-none placeholder:text-text-tertiary"
            />
          </div>
          <button
            type="button"
            disabled={loading || !draftQuery.trim()}
            onClick={submitSearch}
            className="rounded-xl bg-accent px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
          >
            Search
          </button>
        </div>

        <div className="mt-3">
          <SearchFilterBar
            type={typeFilter}
            source={sourceFilter}
            timePreset={timePreset}
            typeOptions={response?.facets.byType ?? []}
            sourceOptions={response?.facets.bySource ?? []}
            disabled={loading}
            onTypeChange={(value) => setTypeFilter(value)}
            onSourceChange={(value) => setSourceFilter(value)}
            onTimePresetChange={setTimePreset}
            onClear={handleClearFilters}
          />
        </div>

        {indexStatus ? (
          <div className="mt-4 flex flex-wrap gap-2 text-xs text-text-tertiary">
            <span>Total {indexStatus.totalDocuments}</span>
            <span>Indexed {indexStatus.indexedDocuments}</span>
            <span>Pending {indexStatus.pendingDocuments}</span>
            <span>Stale {indexStatus.staleDocuments}</span>
            <span>Failed {indexStatus.failedDocuments}</span>
          </div>
        ) : null}
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto p-4">
        {hasSearched && response ? (
          <div className="flex flex-wrap items-center gap-2 text-xs text-text-tertiary">
            <span>{response.total} results</span>
            <span>{response.durationMs} ms</span>
            <span>Normalized query: {response.normalizedQuery}</span>
            {filtersAppliedText ? <span>{filtersAppliedText}</span> : null}
          </div>
        ) : null}

        {loading && !loadingMore ? (
          <div className="flex items-center justify-center py-12 text-text-tertiary">
            <Loader2 className="animate-spin" size={18} />
          </div>
        ) : null}

        {!loading && hasSearched && results.length === 0 ? (
          <SearchEmptyState
            hasFilters={Boolean(typeFilter || sourceFilter || timePreset !== 'all')}
            indexStatus={indexStatus}
            canReindex={permissions.canEditDocuments}
            onClearFilters={handleClearFilters}
            onOpenOperations={onOpenOperations}
          />
        ) : null}

        {!loading && results.length > 0 ? (
          <div className="space-y-3">
            {results.map((result) => (
              <SearchResultCard
                key={`${result.documentId}-${result.blockId ?? 'document'}`}
                result={result}
                onOpenDoc={onNavigateDoc}
                onReindex={permissions.canEditDocuments ? handleReindex : undefined}
                canReindex={permissions.canEditDocuments}
                reindexing={reindexingDocId === result.documentId}
                onOpenSurfaceTarget={onOpenSurfaceTarget}
              />
            ))}
          </div>
        ) : null}

        {response?.nextCursor ? (
          <div className="flex justify-center">
            <button
              type="button"
              disabled={loadingMore}
              onClick={() => setCursor(response.nextCursor)}
              className="rounded-lg border border-border px-4 py-2 text-sm text-text-secondary transition-colors hover:bg-surface-tertiary disabled:opacity-60"
            >
              {loadingMore ? 'Loading...' : 'Load more'}
            </button>
          </div>
        ) : null}

        {!hasSearched ? (
          <div className="rounded-2xl border border-dashed border-border bg-panel p-6 text-center text-sm text-text-tertiary">
            Search returns snippets, highlights, freshness, and filter facets once you submit a query.
          </div>
        ) : null}
      </div>
    </div>
  );
}

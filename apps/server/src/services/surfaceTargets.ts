import type { JobType } from './jobService.js';

export type SurfaceLinkTarget =
  | {
      surface: 'document';
      payload: {
        documentId?: string;
        threadId?: string;
        commentId?: string;
      };
      context?: {
        tab?: string;
        section?: string;
        query?: string;
        anchor?: string;
        filter?: string;
      };
    }
  | {
      surface: 'search';
      payload: {
        query?: string;
        documentId?: string;
      };
      context?: {
        tab?: string;
        section?: string;
        query?: string;
        anchor?: string;
        filter?: string;
      };
    }
  | {
      surface: 'agent';
      payload: {
        runId?: string;
        jobId?: string;
      };
      context?: {
        tab?: string;
        section?: string;
        query?: string;
        anchor?: string;
        filter?: string;
      };
    }
  | {
      surface: 'operations';
      payload: {
        jobId?: string;
        jobType?: JobType | 'all';
        resourceType?: string;
        resourceId?: string;
      };
      context?: {
        tab?: string;
        section?: string;
        query?: string;
        anchor?: string;
        filter?: string;
      };
    }
  | {
      surface: 'admin';
      payload: {
        section?: 'summary' | 'usage' | 'alerts' | 'audit';
      };
      context?: {
        tab?: string;
        section?: string;
        query?: string;
        anchor?: string;
        filter?: string;
      };
    }
  | {
      surface: 'inbox';
      payload: Record<string, never>;
      context?: {
        tab?: string;
        section?: string;
        query?: string;
        anchor?: string;
        filter?: string;
      };
    };

export function createDocumentTarget(params: {
  documentId?: string | null;
  threadId?: string | null;
  commentId?: string | null;
}): SurfaceLinkTarget {
  return {
    surface: 'document',
    payload: {
      ...(params.documentId ? { documentId: params.documentId } : {}),
      ...(params.threadId ? { threadId: params.threadId } : {}),
      ...(params.commentId ? { commentId: params.commentId } : {}),
    },
  };
}

export function createOperationsTarget(params: {
  jobId?: string | null;
  jobType?: JobType | 'all' | null;
  resourceType?: string | null;
  resourceId?: string | null;
  filter?: string | null;
} = {}): SurfaceLinkTarget {
  return {
    surface: 'operations',
    payload: {
      ...(params.jobId ? { jobId: params.jobId } : {}),
      ...(params.jobType ? { jobType: params.jobType } : {}),
      ...(params.resourceType ? { resourceType: params.resourceType } : {}),
      ...(params.resourceId ? { resourceId: params.resourceId } : {}),
    },
    ...(params.filter
      ? {
          context: {
            filter: params.filter,
          },
        }
      : {}),
  };
}

export function createAgentTarget(params: {
  runId?: string | null;
  jobId?: string | null;
}): SurfaceLinkTarget {
  return {
    surface: 'agent',
    payload: {
      ...(params.runId ? { runId: params.runId } : {}),
      ...(params.jobId ? { jobId: params.jobId } : {}),
    },
  };
}

export function createSearchTarget(params: {
  query?: string | null;
  documentId?: string | null;
  filter?: string | null;
} = {}): SurfaceLinkTarget {
  return {
    surface: 'search',
    payload: {
      ...(params.query ? { query: params.query } : {}),
      ...(params.documentId ? { documentId: params.documentId } : {}),
    },
    ...(params.filter
      ? {
          context: {
            filter: params.filter,
            query: params.query ?? undefined,
          },
        }
      : {}),
  };
}

export function createAdminTarget(section: 'summary' | 'usage' | 'alerts' | 'audit' = 'summary'): SurfaceLinkTarget {
  return {
    surface: 'admin',
    payload: { section },
    context: { section },
  };
}

import { AsyncLocalStorage } from 'node:async_hooks';

export interface DbRequestContext {
  requestId?: string;
  userId?: string | null;
  userEmail?: string | null;
  workspaceId?: string | null;
  bypassRls?: boolean;
}

const storage = new AsyncLocalStorage<DbRequestContext>();

function normalizeContext(context: Partial<DbRequestContext>): DbRequestContext {
  return {
    requestId: context.requestId,
    userId: context.userId ?? null,
    userEmail: context.userEmail ?? null,
    workspaceId: context.workspaceId ?? null,
    bypassRls: Boolean(context.bypassRls),
  };
}

export function getDbRequestContext(): DbRequestContext | null {
  return storage.getStore() ?? null;
}

export function runWithDbRequestContext<T>(context: Partial<DbRequestContext>, fn: () => T): T {
  const parent = storage.getStore();
  const nextContext = {
    ...parent,
    ...normalizeContext(context),
  };
  return storage.run(nextContext, fn);
}

export function updateDbRequestContext(context: Partial<DbRequestContext>): DbRequestContext | null {
  const current = storage.getStore();
  if (!current) return null;
  Object.assign(current, normalizeContext({ ...current, ...context }));
  return current;
}

export function runWithSystemDbContext<T>(
  context: Omit<Partial<DbRequestContext>, 'bypassRls'>,
  fn: () => T
): T {
  return runWithDbRequestContext({ ...context, bypassRls: true }, fn);
}

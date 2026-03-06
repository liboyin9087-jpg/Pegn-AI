import { searchService } from './search.js';

export async function markDocumentStaleFromBlockMutation(documentId: string, workspaceId: string): Promise<void> {
  await searchService.markDocumentIndexStale(documentId, workspaceId);
}

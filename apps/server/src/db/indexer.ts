import crypto from 'node:crypto';
import * as Y from 'yjs';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { pool } from './client.js';
import { DocumentModel } from '../models/document.js';
import { BlockModel } from '../models/block.js';

async function generateEmbedding(text: string): Promise<number[]> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || !text.trim()) return [];
  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: 'text-embedding-004' });
    const result = await model.embedContent(text);
    return result.embedding.values;
  } catch (error) {
    console.error('[indexer] Embedding 失敗', error);
    return [];
  }
}

export interface IndexBlockInput {
  blockId: string;
  text: string;
  blockType: string;
  content?: Record<string, any>;
  embedding?: number[];
  position?: number;
  parentId?: string;
}

export interface IndexRequest {
  workspaceId: string;
  documentId?: string;
  title?: string;
  blocks: IndexBlockInput[];
  yjsState?: Uint8Array;
  createdBy?: string;
}

function toVectorLiteral(embedding?: number[]): string | null {
  if (!embedding || embedding.length === 0) {
    return null;
  }
  return `[${embedding.join(',')}]`;
}

export async function indexDocument(request: IndexRequest): Promise<string> {
  if (!pool) {
    throw new Error('Database not available');
  }

  let documentId = request.documentId;

  // Create or update document
  if (documentId) {
    const existingDoc = await DocumentModel.findById(documentId);
    if (existingDoc) {
      await DocumentModel.update(documentId, {
        title: request.title,
        content: { blocks: request.blocks.length },
        yjs_state: request.yjsState ? Buffer.from(request.yjsState) : undefined,
        last_modified_by: request.createdBy
      });
    } else {
      const newDoc = await DocumentModel.create({
        workspace_id: request.workspaceId,
        title: request.title || 'Untitled Document',
        content: { blocks: request.blocks.length },
        yjs_state: request.yjsState ? Buffer.from(request.yjsState) : undefined,
        created_by: request.createdBy
      });
      documentId = newDoc.id;
    }
  } else {
    const newDoc = await DocumentModel.create({
      workspace_id: request.workspaceId,
      title: request.title || 'Untitled Document',
      content: { blocks: request.blocks.length },
      yjs_state: request.yjsState ? Buffer.from(request.yjsState) : undefined,
      created_by: request.createdBy
    });
    documentId = newDoc.id;
  }

  // Index blocks
  for (const block of request.blocks) {
    await BlockModel.upsert(documentId, block.blockId, {
      block_type: block.blockType,
      content: block.content || { text: block.text },
      position: block.position || 0,
      parent_id: block.parentId
    });

    // Update search index
    await updateSearchIndex(documentId, block);
  }

  return documentId;
}

async function updateSearchIndex(documentId: string, block: IndexBlockInput): Promise<void> {
  if (!pool) return;

  const embeddingLiteral = toVectorLiteral(block.embedding);
  
  await pool.query(
    `
    INSERT INTO search_index (document_id, block_id, content, content_vector, title)
    VALUES ($1, $2, $3, $4, $5)
    ON CONFLICT (document_id, block_id)
    DO UPDATE SET
      content = EXCLUDED.content,
      content_vector = EXCLUDED.content_vector,
      title = EXCLUDED.title,
      updated_at = NOW()
    `,
    [
      documentId,
      block.blockId,
      block.text,
      embeddingLiteral,
      block.blockType
    ]
  );
}

export async function indexFromYjsState(
  workspaceId: string,
  documentId: string,
  yjsState: Uint8Array,
  title?: string,
  createdBy?: string
): Promise<void> {
  const ydoc = new Y.Doc();
  Y.applyUpdate(ydoc, yjsState);

  // Extract blocks from Yjs document
  const blocks: IndexBlockInput[] = [];
  const yBlocks = ydoc.getMap('blocks');

  for (const [blockId, yBlock] of yBlocks) {
    const blockData = yBlock as Y.Map<any>;
    const blockType = blockData.get('type') || 'text';
    const blockContent = blockData.get('content') || '';
    const position = blockData.get('position') || 0;

    const text = typeof blockContent === 'string' ? blockContent : JSON.stringify(blockContent);
    const embedding = await generateEmbedding(text);
    blocks.push({
      blockId: blockId.toString(),
      text,
      blockType,
      content: { type: blockType, content: blockContent },
      position,
      embedding
    });
  }

  await indexDocument({
    workspaceId,
    documentId,
    title,
    blocks,
    yjsState,
    createdBy
  });
}

export async function removeDocumentFromIndex(documentId: string): Promise<void> {
  if (!pool) return;

  await pool.query('DELETE FROM search_index WHERE document_id = $1', [documentId]);
  await BlockModel.deleteByDocument(documentId);
  await DocumentModel.delete(documentId);
}

export async function reindexWorkspace(workspaceId: string): Promise<void> {
  if (!pool) return;

  const documents = await DocumentModel.findByWorkspace(workspaceId);
  
  for (const document of documents) {
    if (document.yjs_state) {
      await indexFromYjsState(
        workspaceId,
        document.id,
        new Uint8Array(document.yjs_state),
        document.title,
        document.created_by
      );
    }
  }
}

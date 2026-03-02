#!/usr/bin/env node
/* eslint-disable no-console */

import fs from 'node:fs/promises';
import path from 'node:path';

function usage() {
  console.log(`Usage:
  node scripts/retrieval-eval.js --dataset ./retrieval-eval.dataset.json

Environment:
  RETRIEVAL_EVAL_API_URL   default: http://localhost:4000/api/v1/search
  RETRIEVAL_EVAL_TOKEN     optional bearer token
  RETRIEVAL_EVAL_TOP_K     default: 10
`);
}

function parseArgs(argv) {
  const result = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      result.help = true;
      continue;
    }
    if (arg === '--dataset') {
      result.dataset = argv[i + 1];
      i += 1;
    }
  }
  return result;
}

function reciprocalRank(resultIds, relevantIds) {
  for (let i = 0; i < resultIds.length; i += 1) {
    if (relevantIds.has(resultIds[i])) return 1 / (i + 1);
  }
  return 0;
}

function recallAtK(resultIds, relevantIds) {
  if (relevantIds.size === 0) return 0;
  let hits = 0;
  for (const id of resultIds) {
    if (relevantIds.has(id)) hits += 1;
  }
  return hits / relevantIds.size;
}

function ndcgAtK(resultIds, relevantIds) {
  let dcg = 0;
  for (let i = 0; i < resultIds.length; i += 1) {
    if (!relevantIds.has(resultIds[i])) continue;
    dcg += 1 / Math.log2(i + 2);
  }

  let idealDcg = 0;
  const idealLen = Math.min(relevantIds.size, resultIds.length);
  for (let i = 0; i < idealLen; i += 1) {
    idealDcg += 1 / Math.log2(i + 2);
  }

  if (idealDcg === 0) return 0;
  return dcg / idealDcg;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }

  const datasetPath = args.dataset || process.env.RETRIEVAL_EVAL_DATASET;
  if (!datasetPath) {
    usage();
    process.exitCode = 1;
    return;
  }

  const apiUrl = process.env.RETRIEVAL_EVAL_API_URL || 'http://localhost:4000/api/v1/search';
  const token = process.env.RETRIEVAL_EVAL_TOKEN || '';
  const topK = Number(process.env.RETRIEVAL_EVAL_TOP_K || 10);

  const resolvedDatasetPath = path.resolve(process.cwd(), datasetPath);
  const raw = await fs.readFile(resolvedDatasetPath, 'utf8');
  const dataset = JSON.parse(raw);

  if (!Array.isArray(dataset) || dataset.length === 0) {
    throw new Error('Dataset must be a non-empty array');
  }

  const rows = [];
  for (const entry of dataset) {
    const query = String(entry.query || '').trim();
    const workspaceId = entry.workspace_id || entry.workspaceId;
    const relevantIds = new Set(
      Array.isArray(entry.relevant_document_ids) ? entry.relevant_document_ids.map(String) : []
    );

    if (!query || !workspaceId || relevantIds.size === 0) {
      throw new Error(`Invalid entry: ${JSON.stringify(entry)}`);
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        query,
        workspace_id: workspaceId,
        limit: Number.isFinite(entry.k) ? Number(entry.k) : topK,
        debug: true,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new Error(`Search API failed (${response.status}): ${body}`);
    }

    const payload = await response.json();
    const resultIds = (payload.results || []).map((item) => String(item.document_id)).slice(0, topK);

    const rr = reciprocalRank(resultIds, relevantIds);
    const recall = recallAtK(resultIds, relevantIds);
    const ndcg = ndcgAtK(resultIds, relevantIds);

    rows.push({ query, rr, recall, ndcg, result_count: resultIds.length });
  }

  const avg = (field) => rows.reduce((sum, row) => sum + row[field], 0) / rows.length;
  const report = {
    dataset_size: rows.length,
    top_k: topK,
    mrr: Number(avg('rr').toFixed(6)),
    recall_at_k: Number(avg('recall').toFixed(6)),
    ndcg_at_k: Number(avg('ndcg').toFixed(6)),
    rows,
  };

  console.log(JSON.stringify(report, null, 2));
}

main().catch((error) => {
  console.error('[retrieval-eval] failed:', error);
  process.exitCode = 1;
});

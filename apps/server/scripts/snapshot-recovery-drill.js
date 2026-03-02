#!/usr/bin/env node
/* eslint-disable no-console */
import 'dotenv/config';
import { initDb, pool } from '../src/db/client.js';
import { snapshotService } from '../src/services/snapshot.js';

function usage() {
  console.log(`Usage:
  node scripts/snapshot-recovery-drill.js --document <document_id>
  node scripts/snapshot-recovery-drill.js --workspace <workspace_id> [--limit 10]

Options:
  --document   Run drill for a single document
  --workspace  Run drill for latest documents in a workspace
  --limit      Max documents when workspace mode is used (default: 10)
`);
}

function parseArgs(argv) {
  const args = {
    document: undefined,
    workspace: undefined,
    limit: 10,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
      continue;
    }
    if (arg === '--document') {
      args.document = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--workspace') {
      args.workspace = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === '--limit') {
      const parsed = Number(argv[i + 1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        args.limit = Math.floor(parsed);
      }
      i += 1;
    }
  }

  return args;
}

async function loadWorkspaceDocuments(workspaceId, limit) {
  if (!pool) return [];
  const result = await pool.query(
    `SELECT id
     FROM documents
     WHERE workspace_id = $1
     ORDER BY updated_at DESC
     LIMIT $2`,
    [workspaceId, limit]
  );
  return result.rows.map((row) => row.id);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || (!args.document && !args.workspace)) {
    usage();
    process.exitCode = args.help ? 0 : 1;
    return;
  }

  await initDb();
  if (!pool) {
    throw new Error('DATABASE_URL is required');
  }

  let documentIds = [];
  if (args.document) {
    documentIds = [args.document];
  } else if (args.workspace) {
    documentIds = await loadWorkspaceDocuments(args.workspace, args.limit);
  }

  if (documentIds.length === 0) {
    throw new Error('No documents found for drill');
  }

  const reports = [];
  for (const documentId of documentIds) {
    const report = await snapshotService.runRecoveryDrill(documentId);
    reports.push(report);
  }

  const summary = {
    run_at: new Date().toISOString(),
    documents_total: reports.length,
    documents_passed: reports.filter((report) => report.checks.restore_success).length,
    documents_failed: reports.filter((report) => !report.checks.restore_success).length,
    average_total_ms: Math.round(
      reports.reduce((sum, report) => sum + report.timing_ms.total, 0) / reports.length
    ),
    reports,
  };

  console.log(JSON.stringify(summary, null, 2));
  if (summary.documents_failed > 0) {
    process.exitCode = 2;
  }
}

main()
  .catch((error) => {
    console.error('[snapshot-drill] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool?.end();
  });

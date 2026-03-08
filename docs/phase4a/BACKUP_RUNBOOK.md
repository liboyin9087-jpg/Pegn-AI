# Backup Runbook

## Goal
Maintain recoverable PostgreSQL and Redis data for Closed Beta operations.

## Minimum procedure
1. Take daily PostgreSQL backups and retain at least 14 days.
2. Validate at least one restore per week into a non-production environment.
3. Treat Redis as rebuildable cache/queue state unless product requirements change.
4. Record backup timestamps, restore duration, and restore success/failure in an ops log.

## Recovery checklist
1. Confirm incident scope and freeze destructive writes if needed.
2. Restore the latest known-good PostgreSQL snapshot.
3. Run `npm run migrate:up -w apps/server`.
4. Smoke check `GET /health/detailed` and `GET /metrics`.
5. Validate auth, document CRUD, agent run creation, inbox notifications, and KG load.

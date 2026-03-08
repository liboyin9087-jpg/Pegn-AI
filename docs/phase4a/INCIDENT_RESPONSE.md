# Incident Response

## Severity model
- `SEV-1`: complete outage, cross-workspace data leak, or unrecoverable auth failure.
- `SEV-2`: core workflow degraded for multiple customers.
- `SEV-3`: isolated bug or partial feature degradation.

## First 15 minutes
1. Assign incident commander.
2. Capture timestamp, affected workspace(s), and user-visible symptom.
3. Check `/health/detailed`, logs, and recent deploy/migration history.
4. Decide rollback, traffic freeze, or feature disable.

## Communication
- Internal owner: engineering lead.
- External channel: status page update plus direct customer follow-up for affected beta tenants.
- Postmortem due within 2 business days for `SEV-1` and `SEV-2`.

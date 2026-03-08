# Billing Phase 4B Notes

## Decision record
- Phase 4A does not ship payment collection.
- Phase 4B should integrate Stripe subscriptions first unless regional requirements force an alternate provider.

## Data contract to preserve
- Workspace-scoped plan state remains anchored in `quota_limits`.
- Usage aggregation remains anchored in `usage_records`.
- Future billing events should map to:
  - subscription created
  - subscription updated
  - invoice paid
  - invoice failed
  - subscription cancelled

## Integration guardrails
- Provider webhook handlers must be idempotent.
- Billing state changes must not bypass workspace authorization checks.
- Plan enforcement stays server-side even after provider integration.

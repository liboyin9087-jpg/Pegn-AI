export function isFeatureEnabled(flagName: string): boolean {
  const raw = process.env[flagName];
  if (raw == null) return true;
  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

// ── A/B Testing ────────────────────────────────────────────────────────────
// Deterministic hash-based variant assignment.
// Same userId + experimentId always maps to the same variant (no DB needed).
// Override via env: AB_<EXPERIMENT_ID>=<variant>  e.g. AB_ONBOARDING_V2=control
//
// Usage:
//   const variant = getABVariant(userId, 'onboarding_v2', ['control', 'treatment']);
//   if (variant === 'treatment') { ... }

function djb2Hash(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
    h >>>= 0; // keep unsigned 32-bit
  }
  return h;
}

export function getABVariant(
  userId: string,
  experimentId: string,
  variants: [string, ...string[]],
): string {
  // Allow env override for testing / forced rollout
  const envKey = `AB_${experimentId.toUpperCase().replace(/[^A-Z0-9]/g, '_')}`;
  const override = process.env[envKey];
  if (override && variants.includes(override)) return override;

  const hash = djb2Hash(`${userId}:${experimentId}`);
  return variants[hash % variants.length];
}

// Helper to check if a user is in the experiment (i.e. not in 'control')
export function isInExperiment(userId: string, experimentId: string): boolean {
  return getABVariant(userId, experimentId, ['control', 'treatment']) === 'treatment';
}


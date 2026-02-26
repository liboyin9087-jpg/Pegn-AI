export function isFeatureEnabled(flagName: string): boolean {
  const raw = process.env[flagName];
  if (raw == null) return true;
  const normalized = raw.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}


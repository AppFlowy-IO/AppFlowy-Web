import { CalculationType } from '@/application/database-yjs/database.type';

/** Single selections retain the original wire format; multiple selections use JSON. */
export function readRollupCondition(raw = ''): string[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);

    if (Array.isArray(parsed) && parsed.every((id) => typeof id === 'string')) {
      return [...new Set(parsed.filter((id): id is string => typeof id === 'string' && id.length > 0))];
    }
  } catch {
    // Existing clients store one opaque option id without JSON quoting.
  }

  return [raw];
}

export function writeRollupCondition(ids: readonly string[]): string {
  const unique = [...new Set(ids.filter(Boolean))];

  return unique.length > 1 ? JSON.stringify(unique) : unique[0] ?? '';
}

export function usesRollupCondition(calculation: CalculationType): boolean {
  return calculation === CalculationType.CountValue || calculation === CalculationType.PercentValue;
}

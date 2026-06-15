export interface InlineReferenceData {
  blockIds: string[];
  number: number;
}

const coerceNumber = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);

    if (Number.isFinite(parsed)) return parsed;
  }

  return null;
};

export const parseInlineReference = (raw: unknown): InlineReferenceData | null => {
  if (!raw) return null;

  let parsed: unknown = raw;

  if (typeof raw === 'string') {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  if (!parsed || typeof parsed !== 'object') return null;

  const data = parsed as { blockIds?: unknown; number?: unknown };
  const blockIdsRaw = data.blockIds;
  const number = coerceNumber(data.number);

  if (!number || !Array.isArray(blockIdsRaw)) return null;

  const blockIds = blockIdsRaw
    .map((id) => (typeof id === 'string' ? id.trim() : ''))
    .filter((id) => id.length > 0);

  if (!blockIds.length) return null;

  return {
    blockIds,
    number,
  };
};

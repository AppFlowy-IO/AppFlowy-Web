/** Person cells arrive as joined JSON arrays; decimal attribution IDs must never pass through Number. */
export function parseRollupPersonIds(raw: string): string[] {
  const value = raw.trim();

  if (!value) return [];
  if (/^\d+(?:\s*,\s*\d+)*$/.test(value)) return value.split(',').map((id) => id.trim());
  const flatten = (item: unknown): string[] | null => {
    if (typeof item === 'string') return item ? [item] : [];
    if (!Array.isArray(item)) return null;
    const children = item.map(flatten);

    return children.some((child) => child === null) ? null : (children as string[][]).flat();
  };

  for (const candidate of [value, `[${value}]`]) {
    try {
      const ids = flatten(JSON.parse(candidate));

      if (ids !== null) return ids;
    } catch {
      /* Try the joined-array representation. */
    }
  }

  return [value];
}

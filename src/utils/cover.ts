export function clampCoverOffset(offset?: number): number {
  if (typeof offset !== 'number' || Number.isNaN(offset)) {
    return 0;
  }

  if (offset > 1) {
    return 1;
  }

  if (offset < -1) {
    return -1;
  }

  return offset;
}

export function coverOffsetToObjectPosition(offset?: number): string {
  const clamped = clampCoverOffset(offset);
  const percent = ((clamped + 1) / 2) * 100;

  return `50% ${percent}%`;
}

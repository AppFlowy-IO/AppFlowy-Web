/** Page formatting shared by Desktop and Web in View.extra.document_width. */
export type DocumentWidth = { mode: 'full' } | { mode: 'fixed'; max_width: number };

export const MIN_DOCUMENT_WIDTH = 480;
export const MAX_DOCUMENT_WIDTH = 1920;
export const DEFAULT_DOCUMENT_WIDTH = 952;

export function parseDocumentWidth(value: unknown): DocumentWidth | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const { mode, max_width } = value as Record<string, unknown>;

  if (mode === 'full') return { mode };
  if (mode === 'fixed' && typeof max_width === 'number' && Number.isFinite(max_width)
    && max_width >= MIN_DOCUMENT_WIDTH && max_width <= MAX_DOCUMENT_WIDTH) {
    return { mode, max_width };
  }

  return undefined;
}

export function documentMaxWidth(width: DocumentWidth | undefined): number | undefined {
  if (!width) return DEFAULT_DOCUMENT_WIDTH;
  return width.mode === 'fixed' ? width.max_width : undefined;
}

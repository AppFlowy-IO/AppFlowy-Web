/** Font of the category labels: the 12px caption at weight 500. */
const CATEGORY_LABEL_FONT = { size: 12, weight: 500 };
/** Average advance of a caption glyph, used when no canvas is available. */
const FALLBACK_CHAR_WIDTH = 7;
/** Labels are short and repeat across renders; this only bounds a long session. */
const MAX_CACHED_WIDTHS = 500;

let context: CanvasRenderingContext2D | null | undefined;
const widths = new Map<string, number>();

function canvasContext() {
  if (context !== undefined) return context;

  try {
    context = document.createElement('canvas').getContext('2d');
  } catch {
    context = null;
  }

  if (context) {
    // The labels inherit the page font; read it once rather than on every measurement.
    const family = getComputedStyle(document.body).fontFamily || 'sans-serif';

    context.font = `${CATEGORY_LABEL_FONT.weight} ${CATEGORY_LABEL_FONT.size}px ${family}`;
  }

  return context;
}

/** Rendered width of a category label, in px. */
export function measureCategoryLabelWidth(text: string): number {
  const cached = widths.get(text);

  if (cached !== undefined) return cached;

  const measuring = canvasContext();
  const width = measuring ? measuring.measureText(text).width : text.length * FALLBACK_CHAR_WIDTH;

  if (widths.size >= MAX_CACHED_WIDTHS) widths.clear();
  widths.set(text, width);
  return width;
}

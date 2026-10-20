type DiagramFormat = 'svg' | 'png';

const PNG_SCALE = 4;
const PNG_MIN_LONG_EDGE = 2048;
const PNG_MAX_EDGE = 8192;
// Bound both dimensions and area: a square 8192px canvas alone would use 256 MiB.
const PNG_MAX_PIXELS = 16 * 1024 * 1024;

export function prepareDiagramExport(svg: string, format: DiagramFormat) {
  const document = new DOMParser().parseFromString(svg, 'image/svg+xml');
  const root = document.documentElement as unknown as SVGSVGElement;

  if (
    root.localName !== 'svg' ||
    root.namespaceURI !== 'http://www.w3.org/2000/svg' ||
    document.querySelector('parsererror')
  ) {
    throw new Error('Unable to export diagram: invalid SVG');
  }

  const viewBox = root.getAttribute('viewBox');
  const bounds = viewBox
    ?.trim()
    .split(/[\s,]+/)
    .map(Number);
  const pixelLength = (value: string | null) =>
    value && /^\d*\.?\d+(?:px)?$/.test(value.trim()) ? Number.parseFloat(value) : NaN;
  const naturalWidth = bounds ? bounds[2] : pixelLength(root.getAttribute('width'));
  const naturalHeight = bounds ? bounds[3] : pixelLength(root.getAttribute('height'));

  if (
    (bounds && (bounds.length !== 4 || !bounds.every(Number.isFinite))) ||
    !Number.isFinite(naturalWidth) ||
    !Number.isFinite(naturalHeight) ||
    naturalWidth <= 0 ||
    naturalHeight <= 0
  ) {
    throw new Error('Unable to export diagram: invalid dimensions');
  }

  let width = naturalWidth;
  let height = naturalHeight;

  if (format === 'png') {
    const longEdge = Math.max(width, height);
    const scale = Math.min(
      Math.max(PNG_SCALE, PNG_MIN_LONG_EDGE / longEdge),
      PNG_MAX_EDGE / longEdge,
      Math.sqrt(PNG_MAX_PIXELS / (width * height))
    );

    width = Math.max(1, Math.floor(width * scale));
    height = Math.max(1, Math.floor(height * scale));
  }

  // Mermaid's responsive width="100%" / max-width is for the editor, not a file.
  // Preserve vector coordinates, and give image decoders an explicit viewport.
  root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  if (!viewBox) root.setAttribute('viewBox', `0 0 ${naturalWidth} ${naturalHeight}`);
  root.setAttribute('width', String(width));
  root.setAttribute('height', String(height));
  for (const property of ['width', 'height', 'max-width', 'max-height', 'min-width', 'min-height']) {
    root.style.removeProperty(property);
  }

  return { svg: new XMLSerializer().serializeToString(root), width, height };
}

export async function createDiagramBlob(svg: string, format: DiagramFormat): Promise<Blob> {
  const prepared = prepareDiagramExport(svg, format);
  const vector = new Blob([prepared.svg], { type: 'image/svg+xml;charset=utf-8' });

  if (format === 'svg') return vector;
  const source = URL.createObjectURL(vector);

  try {
    const image = new window.Image();

    image.src = source;
    await image.decode();
    const canvas = document.createElement('canvas');

    canvas.width = prepared.width;
    canvas.height = prepared.height;
    try {
      const context = canvas.getContext('2d');

      if (!context) throw new Error('Unable to export diagram');
      // Decode the vector at the final resolution instead of enlarging a small bitmap.
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'));

      if (!blob) throw new Error('Unable to export diagram');
      return blob;
    } finally {
      canvas.width = canvas.height = 0;
    }
  } finally {
    URL.revokeObjectURL(source);
  }
}

export async function copyDiagramImage(svg: string) {
  if (!navigator.clipboard?.write || typeof ClipboardItem === 'undefined') {
    throw new Error('Image clipboard is unavailable');
  }

  const image = createDiagramBlob(svg, 'png');

  // Clipboard permission can be rejected before the PNG finishes rendering.
  void image.catch(() => undefined);
  // Start writing in the click handler; awaiting rendering first loses Safari's user gesture.
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': image })]);
}

export async function downloadDiagram(svg: string, format: DiagramFormat) {
  const download = URL.createObjectURL(await createDiagramBlob(svg, format));

  try {
    const link = document.createElement('a');

    link.href = download;
    link.download = `diagram.${format}`;
    link.click();
  } finally {
    // Keep the object URL alive until the browser has started the download.
    window.setTimeout(() => {
      URL.revokeObjectURL(download);
    }, 1000);
  }
}

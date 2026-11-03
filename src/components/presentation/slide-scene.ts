import type { PresentationStyle, Slide } from './types';

export const SLIDE_WIDTH = 13.333333;
export const SLIDE_HEIGHT = 7.5;
export interface SceneBox {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type SceneElement =
  | (SceneBox & {
      type: 'text';
      text: string;
      size: number;
      color: string;
      bold?: boolean;
      title?: boolean;
      font?: string;
    })
  | (SceneBox & { type: 'shape'; shape: 'rect' | 'ellipse' | 'roundRect' | 'line' | 'chevron'; color: string })
  | (SceneBox & { type: 'image'; data: string })
  | (SceneBox & { type: 'table'; columns: string[]; rows: string[][]; color: string; background: string })
  | (SceneBox & { type: 'chart'; items: { label: string; value: number }[]; unit: string; color: string });

function contrast(hex: string) {
  const rgb = hex
    .slice(1)
    .match(/../g)
    ?.map((v) => parseInt(v, 16)) ?? [255, 255, 255];

  return rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114 > 155 ? '#20242B' : '#FFFFFF';
}

function fittedSize(value: string, box: SceneBox, size: number) {
  const length = [...value].reduce((sum, char) => sum + ((char.codePointAt(0) ?? 0) >= 0x2e80 ? 1.8 : 1), 0);
  const estimate = Math.sqrt((box.w * 72 * box.h * 72) / (Math.max(length, 1) * 0.8));

  return Math.max(Math.min(size, 13), Math.min(size, estimate));
}

/** Shared geometry for the preview and editable PPTX. Imported elements keep their original placement. */
export function buildSlideScene(slide: Slide, style: PresentationStyle, index: number, total: number) {
  const template = style.templateSlides?.find((s) => s.id === slide.templateSlideId);

  if (template) {
    let bodyIndex = 0;
    const body = [slide.message, ...slide.points].filter(Boolean);
    const bodySlots = template.elements.filter((e) => e.type === 'text' && e.role === 'body').length;
    const elements: SceneElement[] = template.elements.flatMap((e): SceneElement[] => {
      const box = { x: e.x, y: e.y, w: e.w, h: e.h };

      if (e.type === 'image')
        return e.data && (!style.logoCandidates?.includes(e.data) || e.data === style.logo)
          ? [{ type: 'image', ...box, data: e.data }]
          : [];
      const color = e.color ?? style.color;

      if (e.type === 'shape') return [{ type: 'shape', ...box, shape: e.shape ?? 'rect', color }];
      const value =
        e.role === 'decoration'
          ? e.text ?? ''
          : e.role === 'title'
          ? slide.title
          : slide.templateContent?.[e.id] ??
            (bodyIndex === bodySlots - 1 ? body.slice(bodyIndex++).join('\n\n') : body[bodyIndex++] ?? '');

      return value
        ? [
            {
              type: 'text',
              ...box,
              text: value,
              size: fittedSize(value, box, e.size ?? 18),
              color,
              font: e.font ?? (e.role === 'title' ? style.font : style.bodyFont ?? style.font),
              bold: e.bold,
              title: e.role === 'title',
            },
          ]
        : [];
    });

    return { background: template.background, font: style.font, elements };
  }

  const cover = slide.layout === 'title';
  const background = cover && style.id.includes('bold') ? style.color : style.background;
  const ink = cover ? contrast(background) : style.textColor ?? contrast(background);
  const accent = style.color;
  const elements: SceneElement[] = [];
  const text = (value: string, box: SceneBox, size: number, bold = false, title = false, color = ink) => {
    if (value)
      elements.push({
        type: 'text',
        text: value,
        ...box,
        size: fittedSize(value, box, size),
        color,
        bold,
        title,
        font: title ? style.font : style.bodyFont ?? style.font,
      });
  };

  const shape = (shape: 'rect' | 'ellipse' | 'line', box: SceneBox, color = accent) =>
    elements.push({ type: 'shape', shape, ...box, color });

  if (style.logo) elements.push({ type: 'image', data: style.logo, x: 11.3, y: 0.4, w: 1.1, h: 0.55 });
  if (cover) {
    shape('rect', { x: 0.85, y: 1.45, w: 0.75, h: 0.07 });
    text(slide.title, { x: 0.85, y: 1.95, w: 11.5, h: 1.7 }, 44, true, true);
    text(slide.message, { x: 0.85, y: 3.95, w: 10.8, h: 1.35 }, 21);
    slide.points.slice(0, 3).forEach((p, i) => text(p, { x: 0.85, y: 5.4 + i * 0.35, w: 11.5, h: 0.32 }, 14));
  } else {
    text(slide.title, { x: 0.85, y: 0.65, w: 11.6, h: 1.15 }, 32, true, true);
    text(slide.message, { x: 0.85, y: 1.95, w: 11.6, h: 1.05 }, 18);
    const y = 3.25;

    if (slide.table)
      elements.push({ type: 'table', ...slide.table, x: 0.85, y, w: 11.6, h: 3.4, color: ink, background });
    else if (slide.chart) elements.push({ type: 'chart', ...slide.chart, x: 0.85, y, w: 11.6, h: 3.4, color: accent });
    else if (['columns', 'comparison', 'kpi', 'timeline', 'gallery'].includes(slide.layout)) {
      const count = Math.max(slide.points.length, 1),
        w = 11.6 / count;

      if (slide.layout === 'timeline') shape('rect', { x: 0.85 + w / 2, y: y + 0.3, w: w * (count - 1), h: 0.035 });
      slide.points.forEach((p, i) => {
        const x = 0.85 + i * w;

        if (slide.layout === 'timeline') {
          shape('ellipse', { x: x + w / 2 - 0.11, y: y + 0.2, w: 0.22, h: 0.22 });
          text(p, { x: x + 0.12, y: y + 0.8, w: w - 0.32, h: 2.4 }, 20);
        } else if (slide.layout === 'gallery') {
          // A gallery of source-grounded examples remains useful without invented images.
          shape('rect', { x, y, w: w - 0.25, h: 0.07 });
          text(String(i + 1).padStart(2, '0'), { x, y: y + 0.35, w: 0.9, h: 0.65 }, 32, true, false, accent);
          text(p, { x, y: y + 1.25, w: w - 0.3, h: 1.9 }, 21);
        } else {
          if (i) shape('rect', { x: x - 0.18, y, w: 0.015, h: 3 }, '#C8CFD8');
          text(
            p,
            { x: x + 0.05, y: y + 0.2, w: w - 0.36, h: 2.8 },
            slide.layout === 'kpi' ? 25 : 22,
            slide.layout === 'kpi'
          );
        }
      });
    } else
      slide.points.forEach((p, i) => {
        shape('ellipse', { x: 0.9, y: y + 0.12 + i * 1.05, w: 0.07, h: 0.07 });
        text(p, { x: 1.17, y: y + i * 1.05, w: 11.1, h: 0.9 }, 20);
      });
  }

  text(style.footer, { x: 0.85, y: 7.03, w: 10.5, h: 0.2 }, 9);
  text(`${index + 1} / ${total}`, { x: 11.7, y: 7.03, w: 0.8, h: 0.2 }, 9);
  return { background, font: style.fontFallback || style.font, elements };
}

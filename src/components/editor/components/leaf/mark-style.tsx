import { CSSProperties, ReactNode } from 'react';

import { cn } from '@/lib/utils';
import { renderColor } from '@/utils/color';

/** The registered marks a run of text can carry (rich text spec section 6), as renderers read them. */
export interface RegisteredMarks {
  bold?: unknown;
  italic?: unknown;
  underline?: unknown;
  strikethrough?: unknown;
  code?: unknown;
  font_color?: unknown;
  bg_color?: unknown;
  af_text_color?: unknown;
  af_background_color?: unknown;
}

export interface MarkStyle {
  children: ReactNode;
  classList: string[];
  style: CSSProperties;
}

function colorOf(...values: unknown[]) {
  // The theme colors win over the document colors, as they always have.
  const value = values.find((candidate) => typeof candidate === 'string' && candidate);

  return typeof value === 'string' ? value : undefined;
}

/**
 * The elements, classes and styles of the registered marks: the one mapping
 * the document editor's `Leaf` and the Text cell's static renderer share, so
 * a mark drawn in one is drawn the same in the other (rich text spec R25).
 * Links, mentions, equations and editor-only keys stay with each renderer.
 *
 * `code` is not drawn on an inline object (a mention, an equation or a
 * reference): pass `inlineObject`.
 */
export function applyRegisteredMarks(
  marks: RegisteredMarks,
  children: ReactNode,
  { inlineObject = false }: { inlineObject?: boolean } = {}
): MarkStyle {
  let content = children;
  const classList: string[] = [];
  const style: CSSProperties = {};

  if (marks.underline) content = <u>{content}</u>;
  if (marks.strikethrough) content = <s>{content}</s>;
  if (marks.italic) content = <em>{content}</em>;
  if (marks.bold) content = <strong>{content}</strong>;

  const textColor = colorOf(marks.af_text_color, marks.font_color);
  const backgroundColor = colorOf(marks.af_background_color, marks.bg_color);

  if (textColor) {
    classList.push('text-color');
    style.color = renderColor(textColor);
  }

  if (backgroundColor) {
    classList.push('bg-color');
    style.backgroundColor = renderColor(backgroundColor);
  }

  if (marks.code && !inlineObject) {
    content = (
      <span className={cn('bg-border-primary font-medium', style.color ? undefined : 'text-[#EB5757]')}>{content}</span>
    );
  }

  return { children: content, classList, style };
}

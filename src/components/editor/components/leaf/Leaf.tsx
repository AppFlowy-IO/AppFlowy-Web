import { CSSProperties } from 'react';
import { RenderLeafProps } from 'slate-react';

import { Mention } from '@/application/types';
import FormulaLeaf from '@/components/editor/components/leaf/formula/FormulaLeaf';
import { Href } from '@/components/editor/components/leaf/href';
import MentionLeaf from '@/components/editor/components/leaf/mention/MentionLeaf';
import { InlineReference } from '@/components/editor/components/leaf/reference/InlineReference';
import { parseInlineReference } from '@/components/editor/components/leaf/reference/utils';
import { getInlineCommentIds } from '@/components/inline-comment/editor/anchors';
import { useInlineCommentLeafContextOptional } from '@/components/inline-comment/InlineCommentContext';
import { cn } from '@/lib/utils';
import { renderColor } from '@/utils/color';
import { getFontFamily } from '@/utils/font';

// Inline comment highlight, ported from the desktop
// `buildOverlapAwareCommentTextSpanDecorator`: one amber base color whose alpha
// deepens with the number of overlapping comments, and a stronger underline
// while the comment is focused.
// Hoisted: this runs for every text node in the document on every render.
const EMPTY_COMMENT_IDS: string[] = [];
const HIGHLIGHT_BASE_RGB = '255, 193, 7';
const HIGHLIGHT_ALPHA_STOPS = [0.11, 0.3, 0.5];
const FOCUSED_HIGHLIGHT_ALPHA = 0.38;
const FOCUSED_UNDERLINE_ALPHA = 0.75;

function inlineCommentHighlightAlpha(overlapCount: number, focused: boolean): number {
  const count = Math.max(1, overlapCount);
  let alpha = HIGHLIGHT_ALPHA_STOPS[Math.min(count, HIGHLIGHT_ALPHA_STOPS.length) - 1];

  // Past the tuned stops each extra layer halves the gap to opaque, so the
  // curve keeps rising without saturating.
  for (let index = HIGHLIGHT_ALPHA_STOPS.length; index < count; index++) {
    alpha += (1 - alpha) / 2;
  }

  return focused ? Math.max(alpha, FOCUSED_HIGHLIGHT_ALPHA) : alpha;
}

function inlineCommentHighlightColor(alpha: number): string {
  return `rgba(${HIGHLIGHT_BASE_RGB}, ${alpha})`;
}

export function Leaf({ attributes, children, leaf, text }: RenderLeafProps) {
  const inlineComments = useInlineCommentLeafContextOptional();
  let newChildren = children;

  const classList = [leaf.prism_token, leaf.prism_token && 'token', leaf.class_name].filter(Boolean);

  if (leaf.underline) {
    newChildren = <u>{newChildren}</u>;
  }

  if (leaf.strikethrough) {
    newChildren = <s>{newChildren}</s>;
  }

  if (leaf.italic) {
    newChildren = <em>{newChildren}</em>;
  }

  if (leaf.bold) {
    newChildren = <strong>{newChildren}</strong>;
  }

  const style: CSSProperties = {};
  const inlineCommentIds = inlineComments?.active
    ? getInlineCommentIds(leaf).filter((commentId) => inlineComments.openCommentIds.has(commentId))
    : EMPTY_COMMENT_IDS;

  if (leaf.font_color) {
    classList.push('text-color');
    style['color'] = renderColor(leaf.font_color);
  }

  if (leaf.bg_color) {
    classList.push('bg-color');
    style['backgroundColor'] = renderColor(leaf.bg_color);
  }

  if (leaf.af_text_color) {
    if (!classList.includes('text-color')) {
      classList.push('text-color');
    }

    style['color'] = renderColor(leaf.af_text_color);
  }

  if (leaf.af_background_color) {
    if (!classList.includes('bg-color')) {
      classList.push('bg-color');
    }

    style['backgroundColor'] = renderColor(leaf.af_background_color);
  }

  // The comment decorator is an interaction state, so it must win over
  // persisted text background marks. Applying it last keeps overlap/focus
  // visible on highlighted text while retaining the underlying mark in data.
  if (inlineCommentIds.length > 0) {
    const focused = inlineCommentIds.includes(inlineComments?.focusedCommentId ?? '');
    const alpha = inlineCommentHighlightAlpha(inlineCommentIds.length, focused);

    classList.push('inline-comment-anchor');
    style['backgroundColor'] = inlineCommentHighlightColor(alpha);
    style['textDecoration'] = 'underline';
    style['textDecorationColor'] = inlineCommentHighlightColor(focused ? FOCUSED_UNDERLINE_ALPHA : alpha);
    if (focused) style['textDecorationThickness'] = '1.5px';
    style['cursor'] = 'pointer';
  }

  if (leaf.code && !(leaf.formula || leaf.mention || leaf.reference)) {
    newChildren = (
      <span className={cn('bg-border-primary font-medium font-mono', style['color'] ? undefined : 'text-[#EB5757]')}>
        {newChildren}
      </span>
    );
  }

  if (leaf.href && text.text?.trim()) {
    newChildren = (
      <Href text={text} leaf={leaf} textColor={style['color']}>
        {newChildren}
      </Href>
    );
  }

  if (leaf.font_family) {
    style['fontFamily'] = getFontFamily(leaf.font_family);
  }

  const referenceData = leaf.reference ? parseInlineReference(leaf.reference) : null;

  if (text.text && (leaf.mention || leaf.formula || referenceData)) {
    style['position'] = 'relative';
    if (leaf.mention || referenceData) {
      style['display'] = 'inline-block';
    }

    const node = leaf.mention ? (
      <MentionLeaf text={text} mention={leaf.mention as Mention}>
        {newChildren}
      </MentionLeaf>
    ) : leaf.formula ? (
      <FormulaLeaf formula={leaf.formula} text={text}>
        {newChildren}
      </FormulaLeaf>
    ) : referenceData ? (
      <InlineReference reference={referenceData} text={text}>
        {newChildren}
      </InlineReference>
    ) : null;

    newChildren = node;
  }

  return (
    <span
      {...attributes}
      data-inline-comment-ids={inlineCommentIds.length > 0 ? inlineCommentIds.join(',') : undefined}
      style={style}
      className={`${classList.join(' ')}`}
      onClick={() => {
        if (inlineCommentIds.length === 0 || !window.getSelection()?.isCollapsed) return;
        inlineComments?.openCommentFromAnchor(inlineCommentIds);
      }}
    >
      {newChildren}
    </span>
  );
}

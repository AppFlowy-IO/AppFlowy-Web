import { CSSProperties } from 'react';
import { RenderLeafProps } from 'slate-react';

import { Mention } from '@/application/types';
import FormulaLeaf from '@/components/editor/components/leaf/formula/FormulaLeaf';
import { Href } from '@/components/editor/components/leaf/href';
import MentionLeaf from '@/components/editor/components/leaf/mention/MentionLeaf';
import { InlineReference } from '@/components/editor/components/leaf/reference/InlineReference';
import { parseInlineReference } from '@/components/editor/components/leaf/reference/utils';
import { cn } from '@/lib/utils';
import { renderColor } from '@/utils/color';
import { getFontFamily } from '@/utils/font';

export function Leaf({ attributes, children, leaf, text }: RenderLeafProps) {
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

  if (leaf.code && !(leaf.formula || leaf.mention || leaf.reference)) {
    newChildren = (
      <span className={cn('bg-border-primary font-medium', style['color'] ? undefined : 'text-[#EB5757]')}>
        {newChildren}
      </span>
    );
  }

  if (leaf.href) {
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
    <span {...attributes} style={style} className={`${classList.join(' ')}`}>
      {newChildren}
    </span>
  );
}

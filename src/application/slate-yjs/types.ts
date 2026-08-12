import { Element, NodeEntry } from 'slate';

import type Y from 'yjs';

export type HistoryStackItem = {
  meta: Map<string, unknown>;
};

export type RelativeRange = {
  anchor: Y.RelativePosition;
  focus: Y.RelativePosition;
  anchorEntry: NodeEntry<Element>;
  focusEntry: NodeEntry<Element>;
};

export interface BlockJson {
  id: string;
  ty: string;
  data?: string;
  children?: string;
  external_id?: string;
}

/**
 * Delta attribute carrying the ids of the inline comments anchored to a text
 * segment. Kept out of [EditorMarkFormat] because it is not a user-facing
 * formatting mark, but it travels the same Yjs text format channel — desktop
 * writes the identical `comment-ids` attribute.
 */
export const INLINE_COMMENT_IDS_KEY = 'comment-ids';

export enum EditorMarkFormat {
  Bold = 'bold',
  Italic = 'italic',
  Underline = 'underline',
  StrikeThrough = 'strikethrough',
  Code = 'code',
  Href = 'href',
  Formula = 'formula',
  Mention = 'mention',
  FontColor = 'font_color',
  FontToken = 'af_text_color',
  BgColor = 'bg_color',
  BgToken = 'af_background_color',
  Align = 'align',
}

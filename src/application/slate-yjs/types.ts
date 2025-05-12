import { Element, NodeEntry } from 'slate';
import type { RelativePosition } from 'yjs';

export type HistoryStackItem = {
  meta: Map<string, unknown>;
};

export type RelativeRange = {
  anchor: RelativePosition;
  focus: RelativePosition;
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
  BgColor = 'bg_color',
  Align = 'align',
}


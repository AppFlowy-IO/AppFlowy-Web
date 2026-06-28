import { ReactEditor } from 'slate-react';

interface EditorInlineAttributes {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  font_color?: string;
  bg_color?: string;
  href?: string;
  code?: boolean;
  font_family?: string;
  formula?: string;
  reference?: {
    blockIds?: string[];
    number?: number;
  } | string;
  prism_token?: string;
  class_name?: string;

  mention?: {
    type: string;
    // inline page ref id
    page_id?: string;
    block_id?: string;
    row_id?: string;
    // reminder date ref id
    date?: string;
    end?: string;
    reminder_id?: string;
    reminder_option?: string;
    include_time?: boolean;
    // external link
    url?: string;
    // mention person
    person_id?: string;
    person_name?: string;
    // database and database row references
    database_id?: string;
    database_view_id?: string;
    database_row_id?: string;
    row_document_id?: string;
    data?: Record<string, unknown>;
  };
  af_text_color?: string;
  af_background_color?: string;
}

type CustomElement = {
  children: (CustomText | CustomElement)[];
  type?: string;
  data?: unknown;
  blockId?: string;
  textId?: string;
  relationId?: string;
};

type CustomText = { text: string } & EditorInlineAttributes;

declare module 'slate' {
  interface CustomTypes {
    Editor: BaseEditor & ReactEditor;
    Element: CustomElement;
    Text: CustomText;
  }

  interface BaseEditor {
    isEmbed: (element: CustomElement) => boolean;
  }
}

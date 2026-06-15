import type { Range } from 'slate';

export const PASTE_AS_MENU_EVENT = 'appflowy:paste-as-menu';

export enum PasteAsMenuType {
  Mention = 'mention',
  Url = 'url',
  Bookmark = 'bookmark',
  Embed = 'embed',
}

export interface PasteAsMenuPayload {
  url: string;
  range: Range;
  position?: {
    top: number;
    left: number;
  };
}

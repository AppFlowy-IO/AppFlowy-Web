import { createEditor, Editor, Transforms } from 'slate';
import { withHistory } from 'slate-history';
import { withReact } from 'slate-react';

import { MentionType } from '@/application/types';
import { parseAppFlowyPageLink, workspaceIdFromAppPathname } from '@/utils/url';

import { richTextToSlateValue, slateValueToRichText, withRichTextCell } from '../rich-text-slate';

const workspaceId = '2f8365f8-ce19-4376-8ba0-2b4948ed0f4a';
const pageId = 'd996a5f3-0bca-40ed-96b7-5938de6cdd5d';
const pageLink = `http://localhost/app/${workspaceId}/${pageId}`;

describe('AppFlowy page-link paste in a row Text property', () => {
  const originalPath = window.location.pathname;

  beforeEach(() => {
    window.history.replaceState({}, '', `/app/${workspaceId}/${pageId}`);
  });

  afterEach(() => {
    window.history.replaceState({}, '', originalPath);
  });

  it('is recognized as a same-workspace page by the document URL parser', () => {
    expect(parseAppFlowyPageLink(pageLink, window.location.hostname)).toEqual({ workspaceId, viewId: pageId });
    expect(workspaceIdFromAppPathname(window.location.pathname)).toBe(workspaceId);
  });

  it.each([false, true])('pastes a page mention instead of a URL hyperlink (row title: %s)', (singleLine) => {
    const editor = withRichTextCell(withReact(withHistory(createEditor())), { singleLine });

    editor.children = richTextToSlateValue([]);
    Transforms.select(editor, Editor.end(editor, []));
    editor.insertData({ getData: (type: string) => (type === 'text/plain' ? pageLink : '') } as DataTransfer);

    expect(slateValueToRichText(editor.children)).toEqual([
      { insert: '@', attributes: { mention: { type: MentionType.PageRef, page_id: pageId } } },
    ]);
  });

  it('keeps a block target and types plain text after the mention', () => {
    const editor = withRichTextCell(withReact(withHistory(createEditor())));

    editor.children = richTextToSlateValue([]);
    Transforms.select(editor, Editor.end(editor, []));
    editor.insertData({
      getData: (type: string) => (type === 'text/plain' ? `${pageLink}?blockId=block-1` : ''),
    } as DataTransfer);
    for (const char of ' next') editor.insertText(char);

    expect(slateValueToRichText(editor.children)).toEqual([
      { insert: '@', attributes: { mention: { type: MentionType.PageRef, page_id: pageId, block_id: 'block-1' } } },
      { insert: ' next' },
    ]);
  });

  it.each([
    pageLink.replace('localhost', 'example.com'),
    pageLink.replace(workspaceId, 'cf2d5bb4-d1fd-49c6-8ef1-c96592aead39'),
    `${pageLink}?v=cf2d5bb4-d1fd-49c6-8ef1-c96592aead39`,
  ])('keeps an ineligible page URL as a hyperlink: %s', (url) => {
    const editor = withRichTextCell(withReact(withHistory(createEditor())));

    editor.children = richTextToSlateValue([]);
    Transforms.select(editor, Editor.end(editor, []));
    editor.insertData({ getData: (type: string) => (type === 'text/plain' ? url : '') } as DataTransfer);

    expect(slateValueToRichText(editor.children)).toEqual([{ insert: url, attributes: { href: url } }]);
  });

  it('keeps selected-text linking for an internal page URL', () => {
    const editor = withRichTextCell(withReact(withHistory(createEditor())));

    editor.children = richTextToSlateValue([{ insert: 'Read this' }]);
    Transforms.select(editor, Editor.range(editor, []));
    editor.insertData({ getData: (type: string) => (type === 'text/plain' ? pageLink : '') } as DataTransfer);

    expect(slateValueToRichText(editor.children)).toEqual([{ insert: 'Read this', attributes: { href: pageLink } }]);
  });
});

import * as Y from 'yjs';

import { RowCommentKey } from '@/application/database-yjs/database.type';
import { addComment, getCommentsMap, getRowComments } from '@/application/database-yjs/row_comment';
import { CommentAttachment } from '@/application/row-comment.type';
import { YDoc } from '@/application/types';

describe('Desktop row comment attachment interoperability', () => {
  it('writes the desktop JSON field names and round-trips an attachment-only comment', () => {
    const rowDoc = new Y.Doc() as YDoc;
    const attachment: CommentAttachment = {
      id: 'attachment-id',
      name: 'note.txt',
      url: 'https://example.com/note.txt',
      file_type: 'text/plain',
      size: 5,
      uploaded_at: 1_700_000_000_000,
    };
    const id = addComment(rowDoc, '', 'author-id', undefined, [attachment]);

    expect(JSON.parse(getCommentsMap(rowDoc)!.get(id)!.get(RowCommentKey.Attachments) as string)).toEqual([attachment]);
    const remote = new Y.Doc() as YDoc;

    Y.applyUpdate(remote, Y.encodeStateAsUpdate(rowDoc));
    expect(getRowComments(remote)).toEqual([expect.objectContaining({ id, content: '', attachments: [attachment] })]);
  });
});

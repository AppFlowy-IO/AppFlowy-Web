import { CustomEditor } from '@/application/slate-yjs/command';
import { MentionType } from '@/application/types';
import type { Node, Text } from 'slate';

describe('CustomEditor.getBlockTextContent', () => {
  function getMentionTextContent(mention: NonNullable<Text['mention']>) {
    const node = {
      children: [
        {
          text: '',
          mention,
        },
      ],
    } as Node;

    return CustomEditor.getBlockTextContent(node);
  }

  it('uses display titles for database row page mentions', () => {
    expect(
      getMentionTextContent({
        type: MentionType.PageRef,
        page_id: 'database-view-1',
        database_id: 'database-1',
        row_id: 'row-1',
        data: {
          title: 'Launch checklist',
        },
      })
    ).toBe('Launch checklist');
  });

  it('uses row ids for database row page mentions without display titles', () => {
    expect(
      getMentionTextContent({
        type: MentionType.PageRef,
        page_id: 'database-view-1',
        database_id: 'database-1',
        row_id: 'row-1',
      })
    ).toBe('row-1');
  });

  it('uses person names for person mentions', () => {
    expect(
      getMentionTextContent({
        type: MentionType.Person,
        person_id: 'person-1',
        person_name: 'Ada Lovelace',
        page_id: 'page-1',
      })
    ).toBe('Ada Lovelace');
  });

  it('uses urls for external link mentions', () => {
    expect(
      getMentionTextContent({
        type: MentionType.externalLink,
        url: 'https://example.com',
      })
    ).toBe('https://example.com');
  });
});

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

  it('uses display titles for database mentions', () => {
    expect(
      getMentionTextContent({
        type: MentionType.Database,
        database_id: 'database-1',
        data: {
          title: 'Product roadmap',
        },
      })
    ).toBe('Product roadmap');

    expect(
      getMentionTextContent({
        type: MentionType.DatabaseRow,
        database_id: 'database-1',
        row_id: 'row-1',
        data: {
          title: 'Launch checklist',
        },
      })
    ).toBe('Launch checklist');
  });

  it('uses non-empty fallback labels for database mentions without display titles', () => {
    expect(
      getMentionTextContent({
        type: MentionType.Database,
        database_id: 'database-1',
      })
    ).toBe('Database');

    expect(
      getMentionTextContent({
        type: MentionType.DatabaseRow,
        database_id: 'database-1',
        row_id: 'row-1',
      })
    ).toBe('Database row');
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

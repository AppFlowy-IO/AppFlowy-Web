import { DraftMention, serializeCommentMentions, updateDraftMentions } from '../comment-mentions';

const mention: DraftMention = { start: 3, end: 9, name: 'Alice', personId: 'person-id' };

describe('comment draft mentions', () => {
  it('serializes only the selected mention, leaving identical unselected names alone', () => {
    expect(serializeCommentMentions('Hi @Alice and @Alice', [mention])).toBe('Hi @[Alice](person-id) and @Alice');
  });

  it('tracks mentions when text is inserted or deleted before them', () => {
    const moved = updateDraftMentions('Hi @Alice', 'Hello @Alice', [mention]);

    expect(serializeCommentMentions('Hello @Alice', moved)).toBe('Hello @[Alice](person-id)');
    expect(serializeCommentMentions('@Alice', updateDraftMentions('Hi @Alice', '@Alice', [mention]))).toBe(
      '@[Alice](person-id)'
    );
  });

  it('stops mentioning a person if their name is edited or removed', () => {
    expect(updateDraftMentions('Hi @Alice', 'Hi @Ali', [mention])).toEqual([]);
    expect(updateDraftMentions('Hi @Alice', 'Hi ', [mention])).toEqual([]);
    expect(serializeCommentMentions('Hi @Alina', [mention])).toBe('Hi @Alina');
  });
});

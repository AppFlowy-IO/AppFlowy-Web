import { resolveCitationMarkdown } from '@/components/chat/components/chat-messages/citation-markdown';
import type { ResolvedMessageSource } from '@/components/chat/components/chat-messages/message-sources';

function source(citationId: string | undefined, label: string): ResolvedMessageSource {
  return {
    metadata: {
      citation_id: citationId,
      id: citationId || label,
      name: label,
      source: 'appflowy',
    },
    label,
  };
}

describe('citation markdown', () => {
  it('replaces single, adjacent, and doubled citation markers with source names', () => {
    const markdown = 'First claim [W1][A2].\n\n[[W1]]';

    expect(resolveCitationMarkdown(markdown, [source('W1', 'Kanban Guide'), source('A2', 'Workflow Policies')])).toBe(
      'First claim 【Kanban Guide】【Workflow Policies】.\n\n【Kanban Guide】'
    );
  });

  it('matches complete citation IDs and leaves unknown markers unchanged', () => {
    const markdown = '[W1] [W10] [W2]';

    expect(resolveCitationMarkdown(markdown, [source('W1', 'First source'), source('W10', 'Tenth source')])).toBe(
      '【First source】 【Tenth source】 [W2]'
    );
  });

  it('does not replace citation examples inside inline or block code', () => {
    const markdown = ['Use [A1].', '', '`[A1]` and ``[A1]``', '', '```text', '[A1]', '```', '', '    [A1]'].join('\n');

    expect(resolveCitationMarkdown(markdown, [source('A1', 'Getting Started')])).toBe(
      ['Use 【Getting Started】.', '', '`[A1]` and ``[A1]``', '', '```text', '[A1]', '```', '', '    [A1]'].join('\n')
    );
  });

  it('neutralizes markdown control characters in untrusted source titles', () => {
    const label = 'Guide [draft](url) *one* _two_ `code` {x}|y\\z';

    expect(resolveCitationMarkdown('[W1]', [source('W1', label)])).toBe(
      '【Guide ［draft］（url） ∗one∗ ＿two＿ ˋcodeˋ ｛x｝｜y＼z】'
    );
  });

  it('returns the original markdown when no citation metadata is available', () => {
    expect(resolveCitationMarkdown('Keep [W1].', [source(undefined, 'No citation')])).toBe('Keep [W1].');
    expect(resolveCitationMarkdown('Keep [W1].', [])).toBe('Keep [W1].');
  });
});

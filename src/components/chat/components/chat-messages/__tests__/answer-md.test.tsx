import { render, screen, waitFor } from '@testing-library/react';

import { AnswerMd } from '@/components/chat/components/chat-messages/answer-md';
import type { ResolvedMessageSource } from '@/components/chat/components/chat-messages/message-sources';

const mockSetEditor = jest.fn();

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/chat/provider/editor-provider', () => ({
  useEditorContext: () => ({ setEditor: mockSetEditor, getEditor: jest.fn() }),
}));
jest.mock('@/components/_shared/katex-math', () => ({
  KatexMath: ({ latex }: { latex: string }) => <span data-testid='math'>{latex}</span>,
}));
jest.mock('@/components/chat/components/chat-messages/generated-image', () => ({
  GeneratedImage: ({ url }: { url: string }) => <img alt='' data-testid='generated-image' src={url} />,
}));

describe('AnswerMd', () => {
  beforeEach(() => {
    mockSetEditor.mockClear();
  });

  it('renders citation-resolved markdown', () => {
    const sources: ResolvedMessageSource[] = [
      {
        metadata: {
          citation_id: 'W2',
          id: 'https://example.com/kanban',
          name: 'https://example.com/kanban',
          source: 'web',
          title: 'Kanban Guide',
        },
        label: 'Kanban Guide',
      },
    ];

    render(<AnswerMd mdContent='Use a pull system [W2].' sources={sources} />);

    expect(screen.getByText('Use a pull system 【Kanban Guide】.')).toBeTruthy();
  });

  it('registers page data with equations and code for copy and add to page', async () => {
    render(<AnswerMd id={7} mdContent={'$$\nx = 1\n$$\n\n```ts\nlet a = 1;\n```'} />);

    await waitFor(() =>
      expect(mockSetEditor).toHaveBeenCalledWith(7, expect.objectContaining({ getData: expect.any(Function) }))
    );

    expect(mockSetEditor.mock.calls[0][1].getData()).toEqual([
      { type: 'math_equation', data: { formula: 'x = 1' }, children: [] },
      { type: 'code', data: { language: 'ts' }, delta: [{ insert: 'let a = 1;' }], children: [] },
    ]);
    expect((await screen.findByTestId('math')).textContent).toBe('x = 1');
  });

  it('renders a generated image where the markdown places it', () => {
    const url = 'http://localhost:8000/api/file_storage/ws/v1/blob/chat/f.png';

    render(<AnswerMd mdContent={`Here you go\n\n![Generated Image](${url})`} />);

    expect(screen.getByTestId('generated-image').getAttribute('src')).toBe(url);
  });
});

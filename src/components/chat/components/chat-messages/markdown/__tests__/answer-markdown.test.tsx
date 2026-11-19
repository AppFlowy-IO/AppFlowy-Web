import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { parseAnswerBlocks } from '@/components/chat/components/chat-messages/markdown/answer-blocks';
import { AnswerMarkdown } from '@/components/chat/components/chat-messages/markdown/answer-markdown';

const mockCopy = jest.fn(() => Promise.resolve());
const mockToastSuccess = jest.fn();

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('sonner', () => ({
  toast: { success: (...args: unknown[]) => mockToastSuccess(...args), error: jest.fn() },
}));
jest.mock('@/utils/copy', () => ({ copyTextToClipboard: (text: string) => mockCopy(text) }));
jest.mock('@/components/_shared/katex-math', () => ({
  KatexMath: ({ latex, isInline }: { latex: string; isInline?: boolean }) => (
    <span data-testid={isInline ? 'inline-math' : 'block-math'}>{latex}</span>
  ),
}));
jest.mock('@/components/editor/components/blocks/code/HighlightedCode', () => ({
  __esModule: true,
  default: ({ text, data }: { text: string; data: { language: string } }) => (
    <pre data-testid='highlighted-code' data-language={data.language}>
      <code>{text}</code>
    </pre>
  ),
}));
jest.mock('@/components/editor/components/blocks/code/MermaidDiagram', () => ({
  __esModule: true,
  default: ({ source }: { source: string }) => <div data-testid='mermaid-preview'>{source}</div>,
}));
jest.mock('@/components/chat/components/chat-messages/generated-image', () => ({
  GeneratedImage: ({ url, onRegenerate }: { url: string; onRegenerate?: () => void }) => (
    <img alt='' data-testid='generated-image' data-regenerate={onRegenerate ? 'yes' : 'no'} src={url} />
  ),
}));

function renderMarkdown(markdown: string, props: { streaming?: boolean; onRegenerateImage?: () => void } = {}) {
  return render(<AnswerMarkdown blocks={parseAnswerBlocks(markdown)} {...props} />);
}

describe('AnswerMarkdown', () => {
  beforeEach(() => {
    mockCopy.mockClear();
    mockToastSuccess.mockClear();
  });

  it('renders block math and keeps backslash-parenthesis math inline', async () => {
    renderMarkdown('The identity \\( e^{i\\pi} + 1 = 0 \\) holds.\n\n$$\nE = mc^2\n$$');

    expect((await screen.findByTestId('block-math')).textContent).toBe('E = mc^2');
    expect((await screen.findByTestId('inline-math')).textContent).toBe('e^{i\\pi} + 1 = 0');
    expect(screen.getByText(/The identity/).closest('p')?.textContent).toBe('The identity e^{i\\pi} + 1 = 0 holds.');
  });

  it('shows the language, highlights the code and copies it', async () => {
    renderMarkdown('```python\nprint("hi")\n```');

    expect(screen.getByText('Python')).toBeTruthy();
    expect((await screen.findByTestId('highlighted-code')).getAttribute('data-language')).toBe('python');

    fireEvent.click(screen.getByTestId('chat-code-copy'));

    await waitFor(() => expect(mockCopy).toHaveBeenCalledWith('print("hi")'));
    expect(mockToastSuccess).toHaveBeenCalledWith('chat.success.copied');
  });

  it('renders Mermaid as code while streaming and as a diagram once complete', async () => {
    const markdown = '```mermaid\ngraph TD\n  A --> B\n```';
    const { rerender } = render(<AnswerMarkdown blocks={parseAnswerBlocks(markdown)} streaming />);

    expect((await screen.findByTestId('highlighted-code')).textContent).toContain('A --> B');
    expect(screen.queryByTestId('mermaid-preview')).toBeNull();

    rerender(<AnswerMarkdown blocks={parseAnswerBlocks(markdown)} streaming={false} />);

    expect((await screen.findByTestId('mermaid-preview')).textContent).toContain('A --> B');

    fireEvent.click(screen.getByRole('button', { name: 'chat.code.code' }));

    expect(await screen.findByTestId('highlighted-code')).toBeTruthy();
    expect(screen.queryByTestId('mermaid-preview')).toBeNull();
  });

  it('renders headings, marks, safe links, lists, tables, quotes and dividers', () => {
    renderMarkdown(
      '## Plan\n\nUse **bold** and [docs](https://appflowy.io) and [bad](javascript:alert(1)).\n\n3. three\n4. four\n\n- [x] done\n\n| h | i |\n| - | - |\n| 1 | 2 |\n\n> quoted\n\n---'
    );

    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Plan');
    expect(screen.getByText('bold').closest('strong')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'docs' }).getAttribute('href')).toBe('https://appflowy.io');
    expect(screen.queryByRole('link', { name: 'bad' })).toBeNull();
    expect(screen.getByText('bad')).toBeTruthy();
    expect(screen.getAllByRole('listitem')[0].getAttribute('value')).toBe('3');
    expect(screen.getByRole<HTMLInputElement>('checkbox').checked).toBe(true);
    expect(screen.getByRole('columnheader', { name: 'h' })).toBeTruthy();
    expect(screen.getByRole('cell', { name: '2' })).toBeTruthy();
    expect(screen.getByText('quoted').closest('blockquote')).not.toBeNull();
    expect(screen.getByRole('separator')).toBeTruthy();
  });

  it('renders an image line as a generated image and offers regenerate only for AppFlowy files', () => {
    renderMarkdown(
      '![Generated Image](http://localhost:8000/api/file_storage/ws/v1/blob/chat/file.png)\n\n![External](https://example.com/x.png)',
      { onRegenerateImage: jest.fn() }
    );

    const images = screen.getAllByTestId('generated-image');

    expect(images[0].getAttribute('data-regenerate')).toBe('yes');
    expect(images[1].getAttribute('data-regenerate')).toBe('no');
  });
});

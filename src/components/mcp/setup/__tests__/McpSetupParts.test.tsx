import { render } from '@testing-library/react';

import { RichText } from '../McpSetupParts';

function renderText(text: string) {
  const { container } = render(
    <p>
      <RichText text={text} />
    </p>
  );
  const paragraph = container.firstElementChild as HTMLElement;

  return {
    text: paragraph.textContent,
    code: Array.from(paragraph.querySelectorAll('code')).map((code) => code.textContent),
  };
}

describe('RichText', () => {
  it('renders backtick-quoted parts as inline code', () => {
    expect(renderText('Run `/mcp`, choose appflowy and add `--scope user`.')).toEqual({
      text: 'Run /mcp, choose appflowy and add --scope user.',
      code: ['/mcp', '--scope user'],
    });
  });

  it('keeps text without backticks, and an unmatched backtick, as typed', () => {
    expect(renderText('Open Customize → Connectors.')).toEqual({ text: 'Open Customize → Connectors.', code: [] });
    expect(renderText('`code` first, then a lone ` backtick')).toEqual({
      text: 'code first, then a lone ` backtick',
      code: ['code'],
    });
    expect(renderText('mcp.setup.claude.step1')).toEqual({ text: 'mcp.setup.claude.step1', code: [] });
  });
});

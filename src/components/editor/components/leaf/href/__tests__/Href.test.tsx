import { cleanup, fireEvent, render, screen } from '@testing-library/react';

import { Href } from '../Href';

const mockOpenUrl = jest.fn();

jest.mock('@/utils/url', () => ({ openUrl: (...args: unknown[]) => mockOpenUrl(...args) }));
jest.mock('slate-react', () => ({
  useSlateStatic: () => ({ isElementReadOnly: () => false }),
  useReadOnly: () => true,
}));
jest.mock('@/components/editor/components/leaf/leaf.hooks', () => ({ useLeafContext: () => ({}) }));

afterEach(cleanup);

it('lets a keyboard user follow a rich-text cell link without committing the host editor', () => {
  const hostKeyDown = jest.fn();
  const text = { text: 'AppFlowy', href: 'https://appflowy.io' };

  render(<div onKeyDown={hostKeyDown}><Href leaf={text} text={text}>AppFlowy</Href></div>);
  const link = screen.getByRole('link', { name: 'AppFlowy' });

  link.focus();
  fireEvent.keyDown(link, { key: 'Enter' });
  expect(mockOpenUrl).toHaveBeenCalledWith('https://appflowy.io', '_blank');
  expect(hostKeyDown).not.toHaveBeenCalled();
});

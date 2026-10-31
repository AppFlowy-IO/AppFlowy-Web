import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';

import { getActivePrompts, getPromptHistory } from '../admin-client';
import PromptAdministration from '../PromptAdministration';

import type { ActivePrompts, PromptVersion } from '../admin-client';

jest.mock('../admin-client', () => ({
  activatePromptBundle: jest.fn(),
  getActivePrompts: jest.fn(),
  getPromptBundle: jest.fn(),
  getPromptHistory: jest.fn(),
  getPromptVersion: jest.fn(),
  savePromptBundle: jest.fn(),
  savePromptVersion: jest.fn(),
  testPromptBundle: jest.fn(),
}));
jest.mock('../presentation-client', () => ({ serverOptions: () => ({}) }));
jest.mock('../server-client', () => ({ PresentationAPIError: class extends Error {} }));
jest.mock('../ui', () => ({
  Notice: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Action: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

const bundle = {
  version: 'bundle-v1',
  components: { 'slides.generate': { version: 'component-v1', text: 'Component text', checksum: 'checksum' } },
};
const active = (revision: number): ActivePrompts => ({ active: { bundleId: 'bundle-v1', revision }, bundle });
const saved: PromptVersion = {
  promptKey: 'slides.generate',
  version: 'component-v1',
  text: 'Component text',
  checksum: 'checksum',
  createdAt: '2026-10-01T00:00:00Z',
  metadata: {},
};

beforeEach(() => jest.clearAllMocks());

test('refreshing the active revision keeps the loaded component history without fetching it again', async () => {
  jest.mocked(getActivePrompts).mockResolvedValueOnce(active(3)).mockResolvedValueOnce(active(4));
  jest
    .mocked(getPromptHistory)
    .mockResolvedValueOnce([saved])
    .mockReturnValue(new Promise(() => undefined));
  render(<PromptAdministration workspaceId='workspace' />);
  const entry = await screen.findByText('2026-10-01T00:00:00Z · component-v1');

  fireEvent.click(screen.getByText('Refresh active revision'));
  await screen.findByText(/revision 4/);
  expect(
    screen.getByText('Active revision refreshed. Your selected bundle and component edits are unchanged.')
  ).toBeTruthy();
  expect(getActivePrompts).toHaveBeenCalledTimes(2);
  expect(getPromptHistory).toHaveBeenCalledTimes(1);
  expect(getPromptHistory).toHaveBeenCalledWith('slides.generate', expect.any(AbortSignal));
  expect(screen.getByText('2026-10-01T00:00:00Z · component-v1')).toBe(entry);
});

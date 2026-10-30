import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as React from 'react';

import {
  activatePromptBundle,
  getActivePrompts,
  getPromptBundle,
  getPromptHistory,
  getPromptVersion,
  savePromptBundle,
  savePromptVersion,
  testPromptBundle,
} from '../admin-client';
import PromptAdministration from '../PromptAdministration';
import { presentationRequest, PresentationAPIError } from '../server-client';

jest.mock('../server-client', () => ({
  presentationRequest: jest.fn(),
  PresentationAPIError: class extends Error {
    constructor(message: string, public code: string, public status: number) {
      super(message);
    }
  },
}));
jest.mock('../presentation-client', () => ({ serverOptions: () => ({}) }));
jest.mock('../ui', () => ({
  Notice: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Action: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
}));

beforeEach(() => jest.clearAllMocks());

test('all eight maintainer operations use actual admin contracts and immutable version identities', async () => {
  (presentationRequest as jest.Mock).mockResolvedValue({});
  await getActivePrompts();
  await getPromptHistory('slides.generate');
  await getPromptVersion('slides.generate', 'version');
  await savePromptVersion('slides.generate', 'Exact component bytes');
  await savePromptBundle({ 'slides.generate': { key: 'slides.generate', version: 'version' } });
  await getPromptBundle('bundle');
  await activatePromptBundle('bundle', 7);
  await testPromptBundle({
    workspaceId: 'workspace',
    bundleId: 'bundle',
    task: 'mindmap',
    source: { sources: [{ pageId: 'page' }], options: {} as never },
    execute: false,
  });
  const requests = (presentationRequest as jest.Mock).mock.calls.map(([request]) => request);

  expect(requests.map((request) => `${request.method ?? 'GET'} ${request.url}`)).toEqual([
    'GET /api/admin/presentation/prompts',
    'GET /api/admin/presentation/prompts/slides.generate',
    'GET /api/admin/presentation/prompts/slides.generate/version',
    'PUT /api/admin/presentation/prompts/slides.generate',
    'POST /api/admin/presentation/bundles',
    'GET /api/admin/presentation/bundles/bundle',
    'PUT /api/admin/presentation/active',
    'POST /api/admin/presentation/test',
  ]);
  expect(requests[3].data).toEqual({ text: 'Exact component bytes', metadata: {} });
  expect(requests[6].data).toEqual({ bundleId: 'bundle', expectedRevision: 7 });
  expect(requests[7].data).not.toHaveProperty('system');
});

test('server-denied maintainer access never displays prompt text, editing controls or fixture output', async () => {
  (presentationRequest as jest.Mock).mockRejectedValue(
    new PresentationAPIError('Forbidden', 'NOT_ENOUGH_PERMISSIONS', 403)
  );
  render(<PromptAdministration workspaceId='workspace' />);
  await waitFor(() =>
    expect(screen.getByText('Presentation prompt maintenance requires a server administrator account.')).toBeTruthy()
  );
  expect(screen.queryByRole('textbox')).toBeNull();
  expect(screen.queryByText('Save new component version')).toBeNull();
  expect(screen.queryByText('Copy request')).toBeNull();
  expect(presentationRequest).toHaveBeenCalledTimes(1);
});

test('switching components keeps the text of the selected immutable version without modifying the loaded bundle', async () => {
  const bundle = {
    version: 'bundle-v1',
    components: {
      first: { version: 'first-v1', text: 'Original first component', checksum: 'first-checksum' },
      second: { version: 'second-v1', text: 'Original second component', checksum: 'second-checksum' },
    },
  };
  const original = JSON.stringify(bundle);

  (presentationRequest as jest.Mock).mockImplementation(async (request) => {
    if (request.url === '/api/admin/presentation/prompts') return { active: null, bundle };
    if (request.method === 'PUT') return {
      promptKey: 'first', version: 'first-v2', text: request.data.text,
      checksum: 'saved-checksum', createdAt: '2026-10-28T00:00:00Z', metadata: {},
    };
    return [];
  });
  render(<PromptAdministration workspaceId='workspace' />);
  const input = await screen.findByLabelText('Exact component text');

  fireEvent.change(input, { target: { value: 'Saved first component' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save new component version' }));
  await screen.findByText('Immutable component saved. Save a bundle to pin this version.');
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Component'), { target: { value: 'second' } });
  });
  expect((input as HTMLTextAreaElement).value).toBe('Original second component');
  await act(async () => {
    fireEvent.change(screen.getByLabelText('Component'), { target: { value: 'first' } });
  });
  expect((input as HTMLTextAreaElement).value).toBe('Saved first component');
  expect(JSON.stringify(bundle)).toBe(original);
});

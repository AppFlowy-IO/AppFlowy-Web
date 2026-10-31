import { render, screen, waitFor } from '@testing-library/react';

import { loadPresentation, loadSavedDeck, serverOptions } from '../presentation-client';
import ServerSlideCanvas, { ServerSlideSceneProvider } from '../ServerSlideCanvas';

import type { Artifact, ServerSlidePlan } from '../server-contract';
import type { DeckScene } from '../server-scene';
import type { AxiosRequestConfig } from 'axios';

const mockRequest = jest.fn();

jest.mock('@/application/services/js-services/http', () => ({ getAxiosInstance: () => ({ request: mockRequest }) }));
jest.mock('@/application/session/token', () => ({
  captureTokenSession: () => 'session',
  isTokenSessionCurrent: () => true,
}));

const scope = { workspaceId: 'workspace', pageId: 'page' };
const scene: DeckScene = {
  schemaVersion: 1,
  width: 1280,
  height: 720,
  title: 'Saved deck',
  style: { id: '00000000-0000-0000-0000-000000000000', version: 1 },
  theme: {
    id: 'paper',
    name: 'Paper',
    description: '',
    color: '#112233',
    background: '#FFFFFF',
    textColor: '#000000',
    font: 'Arial',
    bodyFont: 'Arial',
    footer: '',
    palette: [],
    guidelines: '',
  },
  warnings: [],
  slides: [
    {
      id: 'one',
      layout: 'title',
      background: 'FFFFFF',
      notes: '',
      sourceIds: [],
      warnings: [],
      elements: [
        {
          id: 'title',
          kind: 'text',
          bounds: { x: 128, y: 72, width: 640, height: 144 },
          text: 'Saved title',
          font: 'Arial',
          size: 48,
          bold: true,
          color: '112233',
        },
        {
          id: 'image',
          kind: 'image',
          asset_id: 'asset',
          revision: 'rev-1',
          attribution: 'Evidence image',
          bounds: { x: 128, y: 288, width: 640, height: 300 },
        },
      ],
    },
  ],
};
const artifact: Artifact<ServerSlidePlan> = {
  id: 'deck',
  workspaceId: 'workspace',
  version: 3,
  content: { schemaVersion: 1, title: 'Saved deck', slides: [] },
  resultHash: 'hash',
  sourceRevision: 'source-revision',
  generationJobId: null,
  origin: 'ai',
  createdAt: '2026-10-28T00:00:00Z',
  mapStyle: { structure: 'right-facing', branchLine: 'rounded' },
  promptBundleVersion: null,
  compiledPromptChecksum: null,
  providerModel: null,
};

function route(config: AxiosRequestConfig) {
  if (config.url?.endsWith('/scene')) return { status: 200, data: { code: 0, data: scene }, headers: {} };
  if (config.url?.includes('/assets/'))
    return { status: 200, data: new Blob(['png'], { type: 'image/png' }), headers: {} };
  if (config.url?.endsWith('/artifacts/deck')) return { status: 200, data: { code: 0, data: artifact }, headers: {} };
  throw new Error(`Unexpected presentation request ${config.method ?? 'GET'} ${config.url}`);
}

const sceneReads = () =>
  mockRequest.mock.calls.filter(([config]: [AxiosRequestConfig]) => config.url?.endsWith('/scene'));
const assetReads = () =>
  mockRequest.mock.calls.filter(([config]: [AxiosRequestConfig]) => config.url?.includes('/assets/'));

beforeEach(() => {
  mockRequest.mockReset().mockImplementation(async (config: AxiosRequestConfig) => route(config));
  URL.createObjectURL = jest.fn(() => 'blob:image');
  URL.revokeObjectURL = jest.fn();
});

test('previews a loaded deck from the scene read with it and fetches only its images', async () => {
  const deck = await loadSavedDeck(scope, 'deck', 3);

  expect(deck.scene).toEqual({ workspaceId: 'workspace', id: 'deck', version: 3, value: scene });
  expect(sceneReads()).toHaveLength(1);
  render(
    <ServerSlideSceneProvider scope={scope} deck={deck}>
      <ServerSlideCanvas />
      <ServerSlideCanvas miniature />
    </ServerSlideSceneProvider>
  );

  // The slides are on screen at once; nothing waits for a second scene read.
  expect(screen.getAllByText('Saved title')).toHaveLength(2);
  await waitFor(() => expect(screen.getAllByAltText('Evidence image')[0].getAttribute('src')).toBe('blob:image'));
  expect(sceneReads()).toHaveLength(1);
  expect(assetReads()).toHaveLength(1);
  expect(assetReads()[0][0]).toMatchObject({
    url: '/api/presentation/workspace/artifacts/deck/assets/asset',
    params: { version: 3, revision: 'rev-1' },
  });
});

test('reads the scene itself when the deck carries one for another version or workspace', async () => {
  const deck = await loadSavedDeck(scope, 'deck', 3);
  const { rerender } = render(
    <ServerSlideSceneProvider scope={scope} deck={{ ...deck, version: 4 }}>
      <ServerSlideCanvas />
    </ServerSlideSceneProvider>
  );

  expect(screen.getByRole('status').textContent).toContain('Loading saved slide…');
  await screen.findByText('Saved title');
  expect(sceneReads()).toHaveLength(2);
  expect(sceneReads()[1][0]).toMatchObject({ params: { version: 4 } });

  rerender(
    <ServerSlideSceneProvider scope={{ ...scope, workspaceId: 'another-workspace' }} deck={deck}>
      <ServerSlideCanvas />
    </ServerSlideSceneProvider>
  );
  expect(screen.queryByText('Saved title')).toBeNull();
  await screen.findByText('Saved title');
  expect(sceneReads()).toHaveLength(3);
  expect(sceneReads()[2][0]).toMatchObject({ url: '/api/presentation/another-workspace/artifacts/deck/scene' });
});


test('page restoration uses the scoped catalog, retains saved options and never prepares or assesses sources', async () => {
  const options = serverOptions({ slideCount: 13, slideCountMode: 'fixed', includeProperties: false });

  mockRequest.mockImplementation(async (config: AxiosRequestConfig) => {
    const reply = (data: unknown) => ({ status: 200, data: { code: 0, data }, headers: {} });

    if (config.url?.endsWith('/session')) return reply(null);
    if (config.url?.endsWith('/status')) return reply({ themes: [] });
    if (config.url?.endsWith('/styles')) return reply({ items: [], nextCursor: null });
    if (config.url?.endsWith('/decks')) {
      expect(config.params).toMatchObject({ pageId: scope.pageId });
      return reply({ items: [{ ...artifact, kind: 'deck' }], nextCursor: null });
    }

    if (config.url?.endsWith('/artifacts/deck')) return reply({ ...artifact, options });
    return route(config);
  });
  const loaded = await loadPresentation(scope, undefined, true);

  expect(loaded.deck?.id).toBe('deck');
  expect(loaded.deck?.options).toMatchObject({ slideCount: 13, slideCountMode: 'fixed', includeProperties: false });
  expect(sceneReads()).toHaveLength(1);
  expect(mockRequest.mock.calls.some(([config]) => config.method === 'POST')).toBe(false);
});

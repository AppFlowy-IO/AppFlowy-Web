import { act, render, screen, waitFor } from '@testing-library/react';

import { getArtifactAsset, getArtifactScene } from '../presentation-client';
import ServerSlideCanvas, { ServerSlideSceneProvider } from '../ServerSlideCanvas';

import type { DeckScene } from '../server-scene';
import type { SavedDeck } from '../types';

jest.mock('../presentation-client', () => ({ getArtifactScene: jest.fn(), getArtifactAsset: jest.fn() }));
const scope = { workspaceId: 'workspace', pageId: 'page' };
const deck = { id: 'deck', version: 3 } as SavedDeck;
const scene: DeckScene = {
  schemaVersion: 1,
  width: 1280,
  height: 720,
  title: 'Native scene',
  style: { id: 'style', version: 2 },
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
          text: 'Server title',
          font: 'Arial',
          size: 48,
          bold: true,
          color: '112233',
        },
        {
          id: 'image',
          kind: 'image',
          asset_id: 'private-image',
          revision: 'rev-1',
          attribution: 'Evidence image',
          bounds: { x: 128, y: 288, width: 640, height: 300 },
        },
      ],
    },
  ],
};

function Preview({ version = 3, workspaceId = 'workspace' }) {
  return (
    <ServerSlideSceneProvider scope={{ ...scope, workspaceId }} deck={{ ...deck, version }}>
      <ServerSlideCanvas />
      <ServerSlideCanvas miniature />
    </ServerSlideSceneProvider>
  );
}

beforeEach(() => {
  jest.mocked(getArtifactScene).mockReset().mockResolvedValue(scene);
  jest
    .mocked(getArtifactAsset)
    .mockReset()
    .mockResolvedValue(new Blob(['image'], { type: 'image/png' }));
  URL.createObjectURL = jest.fn(() => 'blob:private');
  URL.revokeObjectURL = jest.fn();
});

test('renders saved geometry and shares one authorized image read across previews', async () => {
  const { unmount } = render(<Preview />);

  await screen.findAllByText('Server title');
  expect(getArtifactScene).toHaveBeenCalledTimes(1);
  expect(getArtifactAsset).toHaveBeenCalledTimes(1);
  expect(getArtifactAsset).toHaveBeenCalledWith(scope, 'deck', 3, 'private-image', 'rev-1', expect.any(AbortSignal));
  expect(screen.getAllByText('Server title')[0].style).toMatchObject({
    left: '10%',
    top: '10%',
    width: '50%',
    height: '20%',
    color: 'rgb(17, 34, 51)',
  });
  expect(screen.getAllByAltText('Evidence image')[0].getAttribute('src')).toBe('blob:private');
  const signal = jest.mocked(getArtifactScene).mock.calls[0][3];

  unmount();
  expect(signal?.aborted).toBe(true);
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private');
});

test('does not retain private content when a new workspace read is rejected', async () => {
  const { rerender } = render(<Preview />);

  await screen.findAllByText('Server title');
  jest.mocked(getArtifactScene).mockRejectedValue(new Error('Access revoked'));
  rerender(<Preview workspaceId='another-workspace' />);
  expect(screen.queryByText('Server title')).toBeNull();
  await screen.findAllByText('Access revoked');
  expect(screen.queryByAltText('Evidence image')).toBeNull();
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:private');
});

test('aborts obsolete version requests and never publishes their late scene', async () => {
  let resolveOld!: (value: DeckScene) => void;

  jest.mocked(getArtifactScene).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        resolveOld = resolve;
      })
  );
  const { rerender } = render(<Preview />);
  const signal = jest.mocked(getArtifactScene).mock.calls[0][3];

  rerender(<Preview version={4} />);
  await screen.findAllByText('Server title');
  await act(async () => resolveOld({ ...scene, slides: [{ ...scene.slides[0], elements: [] }] }));
  expect(signal?.aborted).toBe(true);
  expect(screen.getAllByText('Server title')).toHaveLength(2);
  expect(getArtifactAsset).toHaveBeenCalledTimes(1);
});

test('rejects unsupported image formats without hiding the rest of the deck', async () => {
  jest.mocked(getArtifactAsset).mockResolvedValue(new Blob(['<svg/>'], { type: 'image/svg+xml' }));
  render(<Preview />);

  await waitFor(() => expect(screen.getAllByRole('img', { name: 'Image unavailable' })).toHaveLength(2));
  expect(screen.getAllByText('Server title')).toHaveLength(2);
  expect(screen.queryByAltText('Evidence image')).toBeNull();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
});

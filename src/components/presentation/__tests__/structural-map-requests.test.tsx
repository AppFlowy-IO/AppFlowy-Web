import { act, fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';

import { createGenerationRunner, editMap, loadPresentation, loadStructuralMap, saveSession } from '../presentation-client';
import PresentationStudio from '../PresentationStudio';

import type { Artifact } from '../server-contract';
import type { MindMap, PageSnapshot } from '../types';

type ViewerProps = { map: MindMap; onMapChange?: (map: MindMap) => Promise<void> };
let mockViewerProps: ViewerProps | undefined;
let mockMounts = 0;

jest.mock('../presentation-client', () => ({
  PresentationAPIError: class extends Error {},
  createGenerationRunner: jest.fn(),
  loadPresentation: jest.fn(),
  loadStructuralMap: jest.fn(),
  editMap: jest.fn(),
  saveSession: jest.fn(),
  serverOptions: jest.fn(() => ({})),
  styleReference: jest.fn(),
  themeToStyle: (theme: unknown) => theme,
}));
jest.mock('../MindMapViewer', () => {
  const { useState } = jest.requireActual<typeof import('react')>('react');

  return {
    __esModule: true,
    default: function MockViewer(props: ViewerProps) {
      // Collapsed, selected and camera state live as long as this mount does.
      const [mount] = useState(() => ++mockMounts);

      mockViewerProps = props;
      return (
        <div data-testid='server-map' data-mount={mount}>
          {props.map.nodes.map((node) => node.label).join(', ')}
        </div>
      );
    },
  };
});
jest.mock('../SlidesWorkflow', () => ({ __esModule: true, default: () => null }));
jest.mock('../StyleSettings', () => ({ __esModule: true, default: () => null }));
jest.mock('../DocumentPresenter', () => ({ __esModule: true, default: () => null, BlockContent: () => null }));
jest.mock('../DocumentContentProvider', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock('../DocumentOutline', () => ({
  DocumentOutlineContext: jest.requireActual<typeof import('react')>('react').createContext({}),
}));
jest.mock('../document-outline', () => ({ documentOutline: () => ({ headings: [] }) }));
jest.mock('../mindmap-references', () => ({ resolveMapReferences: () => new Map() }));
jest.mock('../source', () => ({ flattenBlocks: () => [], splitDocument: () => [] }));
jest.mock('../ui', () => ({
  Action: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props}>{children}</button>
  ),
  Notice: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
jest.mock('../PresentationPaywall', () => ({ __esModule: true, default: () => null }));
jest.mock('@mui/material/Dialog', () => ({ __esModule: true, default: () => null }));

const source = (): PageSnapshot =>
  ({
    pageId: 'page',
    revision: 'revision',
    title: 'Source',
    kind: 'document',
    blocks: [],
    properties: [],
    warnings: [],
    serverSource: { revision: 'revision', references: {} },
  } as unknown as PageSnapshot);

function artifact(id: string, label: string, version = 1): Artifact<MindMap> {
  return {
    id,
    version,
    workspaceId: 'workspace',
    sourceRevision: 'revision',
    origin: id === 'saved-map' ? 'ai' : 'structural',
    mapStyle: { structure: 'right-facing', branchLine: 'rounded' },
    content: {
      schemaVersion: 1,
      warnings: [],
      nodes: [{ id: 'node', parentId: null, label, summary: '', sourceIds: ['page'] }],
    },
  } as Artifact<MindMap>;
}

const status = {
  plan: 'paid',
  remainingSlides: 100,
  maxSlides: 100,
  themes: [],
  usage: { freeSlides: 0, reservedSlides: 0, freeExports: 0, reservedExports: 0 },
  aiResponses: { accountingReady: true, remaining: 1, limit: 1 },
};
const saved = artifact('saved-map', 'Saved map', 2);
const shown = () => screen.getByTestId('server-map');

beforeEach(() => {
  jest.resetAllMocks();
  mockViewerProps = undefined;
  mockMounts = 0;
  jest.mocked(createGenerationRunner).mockReturnValue(jest.fn());
  jest.mocked(saveSession).mockResolvedValue({ revision: 1 } as never);
  jest
    .mocked(loadPresentation)
    .mockResolvedValue({ status, session: null, styles: [], map: saved.content, mapArtifact: saved } as never);
  jest.mocked(loadStructuralMap).mockResolvedValue(artifact('structure-map', 'Page structure'));
});

test('presenting the saved AI mind map requests no page-structure map', async () => {
  render(
    <PresentationStudio workspaceId='workspace' userId='user' snapshot={source()} initialMode='mindmap' presentMindMap canWrite />
  );
  expect((await screen.findByTestId('server-map')).textContent).toBe('Saved map');
  expect(loadStructuralMap).not.toHaveBeenCalled();
});

test('a ready page-structure map is not requested again for another view or an equal source object', async () => {
  const view = render(
    <PresentationStudio workspaceId='workspace' userId='user' snapshot={source()} initialMode='mindmap' canWrite />
  );

  expect((await screen.findByTestId('server-map')).textContent).toBe('Page structure');
  fireEvent.click(await screen.findByRole('button', { name: 'Saved mind map' }));
  expect(shown().textContent).toBe('Saved map');
  fireEvent.click(screen.getByRole('button', { name: 'From page structure' }));
  expect(shown().textContent).toBe('Page structure');
  fireEvent.click(screen.getByRole('button', { name: 'Source' }));
  fireEvent.click(screen.getByRole('button', { name: 'Mind map' }));
  expect(shown().textContent).toBe('Page structure');
  // A refreshed source with the same revision is the same structure.
  view.rerender(
    <PresentationStudio workspaceId='workspace' userId='user' snapshot={source()} initialMode='mindmap' canWrite />
  );
  await act(async () => undefined);
  expect(shown().textContent).toBe('Page structure');
  expect(loadStructuralMap).toHaveBeenCalledTimes(1);
});

test('another map starts with fresh viewer state while edits to the same map keep it', async () => {
  render(<PresentationStudio workspaceId='workspace' userId='user' snapshot={source()} initialMode='mindmap' canWrite />);
  const structure = await screen.findByTestId('server-map');

  expect(structure.dataset.mount).toBe('1');
  fireEvent.click(await screen.findByRole('button', { name: 'Saved mind map' }));
  expect(shown().textContent).toBe('Saved map');
  expect(shown().dataset.mount).toBe('2');
  jest.mocked(editMap).mockResolvedValue(artifact('saved-map', 'Edited map', 3));
  await act(async () => {
    await mockViewerProps!.onMapChange!(artifact('saved-map', 'Edited map').content);
  });
  expect(shown().textContent).toBe('Edited map');
  expect(shown().dataset.mount).toBe('2');
});

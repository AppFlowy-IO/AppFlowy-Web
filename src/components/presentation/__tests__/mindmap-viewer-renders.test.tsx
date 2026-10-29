import { act, fireEvent, render, screen } from '@testing-library/react';
import { useLayoutEffect, type ReactNode } from 'react';

import { mapBranchPath } from '../mindmap-layout';
import MindMapViewer from '../MindMapViewer';

import type { MapBranchLine, MapStructure } from '../mindmap-layout';
import type { MindMap } from '../types';

// Count branch geometry work independently of camera, selection and menu renders.
jest.mock('../mindmap-layout', () => {
  const actual = jest.requireActual<typeof import('../mindmap-layout')>('../mindmap-layout');

  return { ...actual, mapBranchPath: jest.fn(actual.mapBranchPath) };
});

const observers: { callback: ResizeObserverCallback; targets: Set<Element> }[] = [];

class TestResizeObserver {
  private readonly targets = new Set<Element>();

  constructor(callback: ResizeObserverCallback) {
    observers.push({ callback, targets: this.targets });
  }

  observe(target: Element) {
    this.targets.add(target);
  }

  unobserve(target: Element) {
    this.targets.delete(target);
  }

  disconnect() {
    this.targets.clear();
  }
}

const originalResizeObserver = window.ResizeObserver;

beforeAll(() => {
  window.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver;
});
afterAll(() => {
  window.ResizeObserver = originalResizeObserver;
});
beforeEach(() => {
  observers.length = 0;
  jest.mocked(mapBranchPath).mockClear();
});
afterEach(() => jest.restoreAllMocks());

// Laid out right-facing, this map is 600 × 400: it fits 1000 × 600 at 90% and 400 × 300 at 60%.
const map: MindMap = {
  schemaVersion: 1,
  warnings: [],
  nodes: [
    { id: 'plan', parentId: null, label: 'Launch plan', summary: '', sourceIds: ['page'] },
    { id: 'scope', parentId: 'plan', label: 'Scope', summary: 'What ships first.', sourceIds: ['block-1'] },
    { id: 'risks', parentId: 'plan', label: 'Risks', summary: 'What could slip.', sourceIds: ['block-2'] },
  ],
};

function Viewer({
  value = map,
  mapStyle,
  onMapChange,
}: {
  value?: MindMap;
  mapStyle?: { structure: MapStructure; branchLine: MapBranchLine };
  onMapChange?: (map: MindMap) => Promise<void>;
}) {
  return (
    <MindMapViewer
      map={value}
      mapStyle={mapStyle}
      onMapChange={onMapChange}
      canGenerate={false}
      onGenerate={() => undefined}
      onSlides={() => undefined}
      onSource={() => undefined}
    />
  );
}

function Probe({ children, onCommit }: { children: ReactNode; onCommit: () => void }) {
  useLayoutEffect(onCommit);
  return <>{children}</>;
}

const canvas = () => screen.getByRole('region', { name: 'Interactive mind map' });
const zoom = () => screen.getByLabelText('Zoom level').textContent;
const mapRenders = () => jest.mocked(mapBranchPath).mock.calls.length;

function resizeCanvas(width: number, height: number) {
  const target = canvas();
  const entry = { target, contentRect: { width, height } } as unknown as ResizeObserverEntry;

  act(() => {
    for (const { callback, targets } of observers) if (targets.has(target)) callback([entry], {} as ResizeObserver);
  });
}

test('measures the canvas on mount, so the first fit uses its real size', () => {
  // jsdom has no layout. Only the canvas is measured while the map mounts.
  jest.spyOn(Element.prototype, 'clientWidth', 'get').mockReturnValue(400);
  jest.spyOn(Element.prototype, 'clientHeight', 'get').mockReturnValue(300);
  render(<Viewer />);
  expect(zoom()).toBe('60%');
});

test('refits a resized canvas in place without remounting the map or an unsaved node edit', () => {
  render(<Viewer onMapChange={jest.fn()} />);
  const wrapper = canvas().querySelector('.react-transform-wrapper');

  fireEvent.click(screen.getByRole('button', { name: 'Scope' }));
  fireEvent.click(screen.getByText('Edit node'));
  const label = screen.getByLabelText<HTMLInputElement>('Node label');

  fireEvent.change(label, { target: { value: 'Unsaved scope' } });
  expect(zoom()).toBe('90%');
  resizeCanvas(400, 300);
  expect(zoom()).toBe('60%');
  expect(canvas().querySelector('.react-transform-wrapper')).toBe(wrapper);
  expect(screen.getByLabelText('Node label')).toBe(label);
  expect(label.value).toBe('Unsaved scope');
});

test('ignores resize notifications that keep the rounded size or come from a hidden canvas', () => {
  render(<Viewer />);
  resizeCanvas(400, 300);
  const renders = mapRenders();

  resizeCanvas(400.4, 299.6);
  resizeCanvas(0, 0);
  expect(mapRenders()).toBe(renders);
  expect(zoom()).toBe('60%');
});

test('zooming and the fullscreen pointer bands update without rendering the map', () => {
  render(<Viewer />);
  const element = canvas();
  const renders = mapRenders();
  const move = (clientY: number) =>
    act(() => {
      element.dispatchEvent(new MouseEvent('pointermove', { bubbles: true, clientY }));
    });

  fireEvent.wheel(element.querySelector('.react-transform-wrapper')!, { deltaY: -100 });
  expect(zoom()).toBe('100%');
  const rect = { x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 600, width: 1000, height: 600 };

  element.getBoundingClientRect = () => ({ ...rect, toJSON: () => rect });
  move(560);
  expect([element.dataset.controlsVisible, element.dataset.navigationVisible]).toEqual(['true', 'false']);
  move(20);
  expect([element.dataset.controlsVisible, element.dataset.navigationVisible]).toEqual(['false', 'true']);
  expect(mapRenders()).toBe(renders);
});

test('lays out a new map with its saved style in the first commit', () => {
  const next: MindMap = {
    ...map,
    nodes: [
      { id: 'roadmap', parentId: null, label: 'Roadmap', summary: '', sourceIds: ['page-2'] },
      { id: 'quarter', parentId: 'roadmap', label: 'First quarter', summary: '', sourceIds: ['block-3'] },
    ],
  };
  const commits: string[] = [];
  const record = () => {
    const element = document.querySelector<HTMLElement>('.ps-map-canvas')!;
    const shown = element.querySelector('[data-node-id="roadmap"]') ? 'roadmap' : 'launch plan';

    commits.push(`${shown}: ${element.dataset.structure} ${element.dataset.branchLine}`);
  };

  const view = render(
    <Probe onCommit={record}>
      <Viewer mapStyle={{ structure: 'right', branchLine: 'rounded' }} />
    </Probe>
  );

  view.rerender(
    <Probe onCommit={record}>
      <Viewer value={next} mapStyle={{ structure: 'down', branchLine: 'curved' }} />
    </Probe>
  );
  expect(commits).toEqual(['launch plan: right rounded', 'roadmap: down curved']);
});

test('keeps a newer selection when a node save finishes, and shows the node from the current map', async () => {
  let accept!: () => void;
  const onMapChange = jest.fn(
    () =>
      new Promise<void>((resolve) => {
        accept = resolve;
      })
  );
  const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed');
  const view = render(<Viewer onMapChange={onMapChange} />);

  fireEvent.click(screen.getByRole('button', { name: 'Scope' }));
  fireEvent.click(screen.getByText('Edit node'));
  fireEvent.change(screen.getByLabelText('Node label'), { target: { value: 'Scope v2' } });
  fireEvent.click(screen.getByText('Save node'));
  expect(onMapChange).toHaveBeenCalledTimes(1);
  // Choose another node while the map write is still in flight.
  fireEvent.click(screen.getByRole('button', { name: 'Risks' }));
  await act(async () => accept());
  expect([pressed('Scope'), pressed('Risks')]).toEqual(['false', 'true']);

  view.rerender(
    <Viewer
      value={{ ...map, nodes: map.nodes.map((node) => (node.id === 'risks' ? { ...node, label: 'Accepted' } : node)) }}
      onMapChange={onMapChange}
    />
  );
  expect(screen.getByRole('dialog', { hidden: true }).querySelector('h3')?.textContent).toBe('Accepted');
});


test('selection, context menus and viewport resize reuse branch geometry', () => {
  render(<Viewer />);
  const paths = mapRenders();

  fireEvent.click(screen.getByRole('button', { name: 'Scope' }));
  fireEvent.click(screen.getByRole('button', { name: 'Risks' }));
  fireEvent.contextMenu(screen.getByRole('button', { name: 'Risks' }), { clientX: 20, clientY: 20 });
  resizeCanvas(800, 500);
  expect(mapRenders()).toBe(paths);
});

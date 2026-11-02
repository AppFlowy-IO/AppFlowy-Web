import { act, fireEvent, render, screen } from '@testing-library/react';
import { useTransformEffect, type ReactZoomPanPinchContextState } from 'react-zoom-pan-pinch';

import MindMapNodePopover from '../MindMapNodePopover';

import type { MapPosition } from '../mindmap-layout';
import type { MapNode } from '../types';

jest.mock('react-zoom-pan-pinch', () => ({ useTransformEffect: jest.fn() }));

const node: MapNode = { id: 'topic', parentId: 'root', label: 'Topic', summary: 'Summary', sourceIds: [] };
const at = (x: number, y: number): MapPosition => ({ node, x, y, side: 1, depth: 1, descendantCount: 0 });
const resizeCallbacks: ResizeObserverCallback[] = [];
const observed = new Set<Element>();
let frames: FrameRequestCallback[] = [];

class TestResizeObserver {
  constructor(callback: ResizeObserverCallback) {
    resizeCallbacks.push(callback);
  }

  observe(target: Element) {
    observed.add(target);
  }

  unobserve() {
    return undefined;
  }

  disconnect() {
    return undefined;
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
  resizeCallbacks.length = 0;
  observed.clear();
  frames = [];
  jest.mocked(useTransformEffect).mockClear();
  jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => frames.push(callback));
  jest.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
    frames[id - 1] = () => undefined;
  });
});
afterEach(() => {
  jest.restoreAllMocks();
  document.querySelector('#map-canvas')?.remove();
});

/** A canvas with the selected node and the toolbar; counts measurement passes of the card. */
function canvas() {
  const container = document.createElement('div');

  container.id = 'map-canvas';
  container.innerHTML =
    '<div class="ps-map-node" data-node-id="topic"><button>Topic</button></div><div class="ps-map-controls"></div>';
  document.body.append(container);
  const lookups = jest.spyOn(container, 'querySelectorAll');

  return { container, placements: () => lookups.mock.calls.filter(([selector]) => selector === '.ps-map-node').length };
}

function Card({ container, position }: { container: HTMLElement; position?: MapPosition }) {
  return (
    <MindMapNodePopover
      container={container}
      node={node}
      position={position}
      sourceNumbers={new Map()}
      canDrill={false}
      canParent={false}
      modifierLabel='Ctrl'
      modifierKey='Control'
      onClose={() => undefined}
      onDrill={() => undefined}
      onParent={() => undefined}
      onSource={() => undefined}
      onSave={async () => undefined}
    />
  );
}

const transformChange = (animating: boolean) => {
  const calls = jest.mocked(useTransformEffect).mock.calls;
  const follow = calls[calls.length - 1][0];

  act(() => {
    follow({ instance: { animation: animating ? () => undefined : null } } as unknown as ReactZoomPanPinchContextState);
  });
};

const runFrames = () =>
  act(() => {
    frames.splice(0).forEach((callback) => callback(0));
  });

test('places the card when it opens and when a new layout arrives, not on edits or other renders', () => {
  const { container, placements } = canvas();
  const position = at(40, 40);
  const view = render(<Card container={container} position={position} />);

  expect(placements()).toBe(1);
  fireEvent.click(screen.getByText('Edit node'));
  fireEvent.change(screen.getByLabelText('Node summary'), { target: { value: 'A longer summary' } });
  view.rerender(<Card container={container} position={position} />);
  expect(placements()).toBe(1);
  view.rerender(<Card container={container} position={at(340, 40)} />);
  expect(placements()).toBe(2);
});

test('coalesces pan, zoom, scroll and window resize changes into one placement per frame', () => {
  const { container, placements } = canvas();

  render(<Card container={container} position={at(40, 40)} />);
  transformChange(false);
  transformChange(false);
  act(() => {
    window.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new Event('resize'));
  });
  expect(placements()).toBe(1);
  runFrames();
  expect(placements()).toBe(2);
  runFrames();
  expect(placements()).toBe(2);
});

test('follows pan/zoom animation steps at once and cancels a pending frame when it closes', () => {
  const { container, placements } = canvas();
  const view = render(<Card container={container} position={at(40, 40)} />);

  transformChange(true);
  expect(placements()).toBe(2);
  expect(frames).toHaveLength(0);
  transformChange(false);
  expect(frames).toHaveLength(1);
  view.unmount();
  expect(window.cancelAnimationFrame).toHaveBeenCalledWith(1);
});

test('re-places the card when fullscreen shows or hides the toolbar', () => {
  const { container, placements } = canvas();

  render(<Card container={container} position={at(40, 40)} />);
  expect(observed.has(container.querySelector('.ps-map-controls')!)).toBe(true);
  act(() => resizeCallbacks.forEach((callback) => callback([], {} as ResizeObserver)));
  expect(placements()).toBe(2);
});

import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { createEditor, Descendant, Transforms } from 'slate';
import { Editable, Slate, withReact } from 'slate-react';
import { Awareness } from 'y-protocols/awareness';

import { AwarenessState } from '@/application/awareness/types';
import { EditorContextProvider } from '@/components/editor/EditorContext';

import { RemoteSelectionsLayer } from '../RemoteSelectionsLayer';

jest.mock('@/application/services/domains', () => ({ CollabService: { getDeviceId: () => 'local-device' } }));
jest.mock('@/utils/log', () => ({ Log: { debug: jest.fn(), warn: jest.fn() } }));
jest.mock('lodash-es', () => jest.requireActual('lodash'));

function createAwareness(hasCursor = true) {
  const listeners = new Set<() => void>();
  const states = new Map<number, AwarenessState>();

  if (hasCursor)
    states.set(2, {
      version: 1,
      timestamp: 1,
      user: { uid: 2, device_id: 'remote-device' },
      metadata: JSON.stringify({ user_name: 'Peer', cursor_color: '#000000', selection_color: '#eeeeee' }),
      selection: { start: { path: [0, 0], offset: 0 }, end: { path: [0, 0], offset: 0 } },
    });

  const awareness = {
    clientID: 1,
    getStates: () => states,
    on: (_event: string, listener: () => void) => listeners.add(listener),
    off: (_event: string, listener: () => void) => listeners.delete(listener),
  } as unknown as Awareness;

  return { awareness, emitChange: () => listeners.forEach((listener) => listener()), states, listeners };
}

describe('remote cursor geometry', () => {
  let frames: Map<number, FrameRequestCallback>;
  let nextFrame: number;
  let targetTop: number;
  let rangeMeasurements: jest.Mock;
  let resizeCallbacks: ResizeObserverCallback[];
  let disconnect: jest.Mock;
  const originalResizeObserver = global.ResizeObserver;

  function rectangle(top: number, height = 20): DOMRect {
    return { top, left: 10, right: 10, bottom: top + height, width: 0, height, x: 10, y: top, toJSON: () => ({}) };
  }

  async function flushFrames() {
    await act(async () => {
      const pending = Array.from(frames.values());

      frames.clear();
      pending.forEach((callback) => callback(0));
    });
  }

  function mount(hasCursor = true) {
    const editor = withReact(createEditor());
    const harness = createAwareness(hasCursor);
    const value = [
      { type: 'paragraph', children: [{ type: 'paragraph', children: [{ text: 'target' }] }] },
    ] as Descendant[];
    const view = render(
      <EditorContextProvider workspaceId='workspace' viewId='view' readOnly={false} awareness={harness.awareness}>
        <Slate editor={editor} initialValue={value}>
          <Editable />
          <RemoteSelectionsLayer editor={editor} />
        </Slate>
      </EditorContextProvider>
    );

    return { ...view, ...harness, editor, cursor: () => view.container.querySelector<HTMLElement>('.animate-blink') };
  }

  beforeEach(() => {
    frames = new Map();
    nextFrame = 1;
    targetTop = 100;
    resizeCallbacks = [];
    disconnect = jest.fn();
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      const id = nextFrame++;

      frames.set(id, callback);
      return id;
    });
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation((id) => {
      frames.delete(id);
    });
    jest.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(rectangle(0, 1000));
    rangeMeasurements = jest.fn((range: Range) => {
      return rectangle(range.startContainer.textContent?.startsWith('target') ? targetTop : 50);
    });
    const createRange = document.createRange.bind(document);

    jest.spyOn(document, 'createRange').mockImplementation(() => {
      const range = createRange();

      range.getBoundingClientRect = () => rangeMeasurements(range);
      return range;
    });
    global.ResizeObserver = jest.fn().mockImplementation((callback: ResizeObserverCallback) => {
      resizeCallbacks.push(callback);
      return { observe: jest.fn(), disconnect, unobserve: jest.fn() };
    });
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    global.ResizeObserver = originalResizeObserver;
  });

  it('shows existing awareness state without waiting for another peer update', async () => {
    const view = mount();

    await flushFrames();

    expect(view.cursor()?.style.top).toBe('100px');
  });

  it('reconverts the stationary peer range and remeasures after local document changes', async () => {
    const view = mount();

    act(view.emitChange);
    await flushFrames();
    expect(view.cursor()?.style.top).toBe('100px');

    targetTop = 200;
    await act(async () => {
      Transforms.insertNodes(
        view.editor,
        {
          type: 'paragraph',
          textId: 'new-text',
          children: [{ text: 'prefix' }],
        } as Descendant,
        { at: [0, 0] }
      );
    });
    await flushFrames();

    // The same awareness path now skips the inserted textId wrapper.
    expect(view.cursor()?.style.top).toBe('200px');
  });

  it('coalesces resize and layout signals into one measurement frame', async () => {
    const view = mount();

    act(view.emitChange);
    await flushFrames();
    rangeMeasurements.mockClear();
    targetTop = 250;
    act(() => {
      fireEvent(window, new Event('resize'));
      fireEvent(window, new Event('resize'));
      resizeCallbacks.forEach((callback) => callback([], {} as ResizeObserver));
    });

    expect(rangeMeasurements).not.toHaveBeenCalled();
    await flushFrames();

    expect(rangeMeasurements).toHaveBeenCalledTimes(1);
    expect(view.cursor()?.style.top).toBe('250px');
  });

  it('releases observers, listeners and queued frames when the document unmounts', async () => {
    const view = mount();

    act(view.emitChange);
    await flushFrames();
    fireEvent(window, new Event('resize'));
    view.unmount();
    rangeMeasurements.mockClear();
    act(() => {
      fireEvent(window, new Event('resize'));
      resizeCallbacks.forEach((callback) => callback([], {} as ResizeObserver));
    });
    await flushFrames();

    expect(disconnect).toHaveBeenCalled();
    expect(view.listeners.size).toBe(0);
    expect(rangeMeasurements).not.toHaveBeenCalled();
    expect(frames.size).toBe(0);
  });

  it('clears overlays and stops layout work when the last remote cursor leaves', async () => {
    const view = mount();

    await flushFrames();
    expect(view.cursor()).not.toBeNull();
    act(() => {
      view.states.clear();
      view.emitChange();
    });
    rangeMeasurements.mockClear();
    fireEvent(window, new Event('resize'));
    await flushFrames();

    expect(view.cursor()).toBeNull();
    expect(disconnect).toHaveBeenCalled();
    expect(rangeMeasurements).not.toHaveBeenCalled();
  });

  it('does not measure or subscribe to layout changes without a remote cursor', async () => {
    mount(false);
    fireEvent(window, new Event('resize'));
    await flushFrames();

    expect(rangeMeasurements).not.toHaveBeenCalled();
    expect(global.ResizeObserver).not.toHaveBeenCalled();
  });
});

import { fireEvent, render, screen } from '@testing-library/react';
import { StrictMode, useState } from 'react';

import { TimelineColumnResizeHandle } from '../TimelineColumnResizeHandle';

class TestPointerEvent extends MouseEvent {
  readonly pointerId: number;

  constructor(type: string, options: PointerEventInit = {}) {
    super(type, options);
    this.pointerId = options.pointerId ?? 1;
  }
}

const originalPointerEvent = window.PointerEvent;
const originalCapture = {
  setPointerCapture: HTMLElement.prototype.setPointerCapture,
  hasPointerCapture: HTMLElement.prototype.hasPointerCapture,
  releasePointerCapture: HTMLElement.prototype.releasePointerCapture,
};

beforeAll(() => {
  // jsdom has no pointer-capture implementation; browser coverage uses real capture.
  window.PointerEvent = TestPointerEvent as typeof PointerEvent;
  HTMLElement.prototype.setPointerCapture = jest.fn();
  HTMLElement.prototype.hasPointerCapture = jest.fn(() => true);
  HTMLElement.prototype.releasePointerCapture = jest.fn();
});

beforeEach(() => jest.clearAllMocks());

afterAll(() => {
  window.PointerEvent = originalPointerEvent;
  Object.assign(HTMLElement.prototype, originalCapture);
});

function setup() {
  const onResize = jest.fn();
  const onCommit = jest.fn();
  const props = { fieldId: 'title', width: 200, minWidth: 100, onResize, onCommit };
  const rendered = render(<TimelineColumnResizeHandle {...props} />);
  const handle = screen.getByTestId('timeline-column-resize-title');

  return { ...rendered, handle, props, onResize, onCommit };
}

test('previews pointer travel despite header layout changes and commits once on release', () => {
  const { handle, props, rerender, onResize, onCommit } = setup();

  fireEvent.pointerDown(handle, { button: 0, clientX: 300 });
  fireEvent.pointerMove(handle, { clientX: 340 });
  expect(onResize).toHaveBeenLastCalledWith('title', 240);
  rerender(<TimelineColumnResizeHandle {...props} width={240} />);
  fireEvent.pointerMove(handle, { clientX: 360 });
  expect(onResize).toHaveBeenLastCalledWith('title', 260);
  expect(onCommit).not.toHaveBeenCalled();
  fireEvent.pointerUp(handle);
  fireEvent.lostPointerCapture(handle);
  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(onCommit).toHaveBeenCalledWith('title', 260);
  expect(onResize).toHaveBeenLastCalledWith('title', null);
});

test.each(['escape', 'cancel', 'lost-capture', 'blur', 'unmount'])(
  '%s abandons the preview without writing',
  (action) => {
    const { handle, onResize, onCommit, unmount } = setup();

    fireEvent.pointerDown(handle, { button: 0, clientX: 300 });
    fireEvent.pointerMove(handle, { clientX: 400 });
    if (action === 'escape') fireEvent.keyDown(window, { key: 'Escape' });
    if (action === 'cancel') fireEvent.pointerCancel(handle);
    if (action === 'lost-capture') fireEvent.lostPointerCapture(handle);
    if (action === 'blur') fireEvent.blur(window);
    if (action === 'unmount') unmount();
    fireEvent.pointerUp(handle);
    expect(onCommit).not.toHaveBeenCalled();
    expect(onResize).toHaveBeenLastCalledWith('title', null);
  }
);

test('clamps narrow columns and does not write for a click or secondary button', () => {
  const { handle, onResize, onCommit } = setup();

  fireEvent.pointerDown(handle, { button: 2, clientX: 300 });
  fireEvent.pointerMove(handle, { clientX: 400 });
  fireEvent.pointerUp(handle);
  expect(onResize).not.toHaveBeenCalled();
  fireEvent.pointerDown(handle, { button: 0, clientX: 300 });
  fireEvent.pointerUp(handle);
  expect(onCommit).not.toHaveBeenCalled();
  fireEvent.pointerDown(handle, { button: 0, clientX: 300 });
  fireEvent.pointerMove(handle, { clientX: 0 });
  expect(onResize).toHaveBeenLastCalledWith('title', 100);
  fireEvent.pointerUp(handle);
  expect(onCommit).toHaveBeenCalledWith('title', 100);
});

test('parent renders with new callbacks preserve the drag and use the latest commit handler', () => {
  const commit = jest.fn();

  function Parent({ revision }: { revision: number }) {
    const [preview, setPreview] = useState<number | null>(null);

    return (
      <>
        <output data-testid='preview'>{preview ?? 200}</output>
        <TimelineColumnResizeHandle
          fieldId='title'
          width={preview ?? 200}
          minWidth={100}
          onResize={(_, width) => setPreview(width)}
          onCommit={(fieldId, width) => commit(fieldId, width, revision)}
        />
      </>
    );
  }

  const { rerender } = render(<Parent revision={0} />, { wrapper: StrictMode });
  const handle = screen.getByTestId('timeline-column-resize-title');

  fireEvent.pointerDown(handle, { button: 0, clientX: 300 });
  fireEvent.pointerMove(handle, { clientX: 340 });
  expect(screen.getByTestId('preview').textContent).toBe('240');
  rerender(<Parent revision={1} />);
  fireEvent.pointerMove(handle, { clientX: 360 });
  expect(screen.getByTestId('preview').textContent).toBe('260');
  fireEvent.pointerUp(handle);
  expect(commit).toHaveBeenCalledTimes(1);
  expect(commit).toHaveBeenCalledWith('title', 260, 1);
});

test('changing fields cancels the old gesture and releases its capture', () => {
  const { handle, props, rerender, onResize, onCommit } = setup();

  fireEvent.pointerDown(handle, { button: 0, clientX: 300 });
  fireEvent.pointerMove(handle, { clientX: 340 });
  rerender(<TimelineColumnResizeHandle {...props} fieldId='owner' />);
  const nextHandle = screen.getByTestId('timeline-column-resize-owner');

  expect(onResize).toHaveBeenLastCalledWith('title', null);
  expect(nextHandle.classList.contains('border-fill-theme-thick')).toBe(false);
  expect(HTMLElement.prototype.releasePointerCapture).toHaveBeenCalledWith(1);
  fireEvent.pointerUp(nextHandle);
  expect(onCommit).not.toHaveBeenCalled();
});

test('another pointer losing capture does not cancel the active drag', () => {
  const { handle, onCommit } = setup();

  fireEvent.pointerDown(handle, { button: 0, pointerId: 1, clientX: 300 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 340 });
  fireEvent.pointerDown(handle, { button: 0, pointerId: 2, clientX: 700 });
  fireEvent.pointerMove(handle, { pointerId: 2, clientX: 900 });
  fireEvent.lostPointerCapture(handle, { pointerId: 2 });
  fireEvent.pointerCancel(handle, { pointerId: 2 });
  fireEvent.pointerUp(handle, { pointerId: 2 });
  fireEvent.pointerMove(handle, { pointerId: 1, clientX: 360 });
  fireEvent.pointerUp(handle, { pointerId: 1 });
  expect(onCommit).toHaveBeenCalledTimes(1);
  expect(onCommit).toHaveBeenCalledWith('title', 260);
});

test('a rejected commit still clears the preview and releases capture', () => {
  const error = new Error('width update failed');
  const errors: unknown[] = [];
  const onError = (event: ErrorEvent) => {
    if (event.error !== error) return;
    errors.push(event.error);
    event.preventDefault();
  };

  const { handle, onCommit, onResize } = setup();

  onCommit.mockImplementation(() => {
    throw error;
  });
  window.addEventListener('error', onError);
  try {
    fireEvent.pointerDown(handle, { button: 0, clientX: 300 });
    fireEvent.pointerMove(handle, { clientX: 340 });
    fireEvent.pointerUp(handle);
    expect(errors).toContain(error);
    expect(onResize).toHaveBeenLastCalledWith('title', null);
    expect(HTMLElement.prototype.releasePointerCapture).toHaveBeenCalledWith(1);
  } finally {
    window.removeEventListener('error', onError);
  }
});

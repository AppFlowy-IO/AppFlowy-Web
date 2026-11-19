import { fireEvent, render, screen } from '@testing-library/react';
import { createRef } from 'react';

import { DriveResizeHandles } from '../DriveResizeHandles';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

it.each([
  ['Left', 'ArrowRight', 'width_factor', 0.45],
  ['Right', 'ArrowRight', 'width_factor', 0.55],
  ['Top', 'ArrowDown', 'height_factor', 0.95],
  ['Bottom', 'ArrowDown', 'height_factor', 1.05],
] as const)('moves the %s edge in the pressed arrow direction', (side, key, dimension, expected) => {
  const onCommit = jest.fn();
  const container = createRef<HTMLDivElement>();

  render(
    <div ref={container}>
      <DriveResizeHandles container={container} data={{ width_factor: 0.5, height_factor: 1 }} onDraft={jest.fn()} onCommit={onCommit} />
    </div>
  );
  Object.defineProperty(container.current, 'clientWidth', { value: 800 });
  fireEvent.keyDown(screen.getByRole('button', { name: `document.plugins.googleDrive.resize${side}` }), { key });
  expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({ [dimension]: expected }));
});

it.each([
  ['Left', 'ArrowDown'],
  ['Right', 'ArrowUp'],
  ['Top', 'ArrowLeft'],
  ['Bottom', 'ArrowRight'],
])('does not resize the %s edge on an arrow for the other axis', (side, key) => {
  const onCommit = jest.fn();

  render(<DriveResizeHandles container={createRef()} data={{}} onDraft={jest.fn()} onCommit={onCommit} />);
  fireEvent.keyDown(screen.getByRole('button', { name: `document.plugins.googleDrive.resize${side}` }), { key });
  expect(onCommit).not.toHaveBeenCalled();
});

it('cancels a captured resize when its source changes instead of writing the old size to the new file', () => {
  const onCommit = jest.fn();
  const onDraft = jest.fn();
  const container = createRef<HTMLDivElement>();
  const contents = (url: string) => (
    <div ref={container}>
      <DriveResizeHandles container={container} data={{ url, width_factor: 0.5 }} onDraft={onDraft} onCommit={onCommit} />
    </div>
  );
  const view = render(contents('https://docs.google.com/document/d/first/edit'));

  Object.defineProperty(container.current, 'clientWidth', { value: 800 });
  const handle = screen.getByRole('button', { name: 'document.plugins.googleDrive.resizeRight' });

  Object.assign(handle, {
    setPointerCapture: jest.fn(),
    hasPointerCapture: () => true,
    releasePointerCapture: jest.fn(),
  });
  const pointer = (type: string, clientX: number) => {
    const event = new Event(type, { bubbles: true });

    Object.assign(event, { pointerId: 1, clientX, clientY: 0 });
    fireEvent(handle, event);
  };

  pointer('pointerdown', 100);
  pointer('pointermove', 180);
  expect(onDraft).toHaveBeenLastCalledWith({ width_factor: 0.6, height_factor: 1 });
  view.rerender(contents('https://docs.google.com/document/d/second/edit'));
  expect(onDraft).toHaveBeenLastCalledWith(undefined);
  pointer('pointerup', 180);
  expect(onCommit).not.toHaveBeenCalled();
});

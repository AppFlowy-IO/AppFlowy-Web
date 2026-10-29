import { fireEvent, render, screen } from '@testing-library/react';

import MindMapViewer from '../MindMapViewer';

import type { MindMap } from '../types';

class TestResizeObserver {
  observe = jest.fn();
  unobserve = jest.fn();
  disconnect = jest.fn();
}

const originalResizeObserver = window.ResizeObserver;

beforeAll(() => {
  window.ResizeObserver = TestResizeObserver as unknown as typeof ResizeObserver;
});
afterAll(() => {
  window.ResizeObserver = originalResizeObserver;
});

const map: MindMap = {
  schemaVersion: 1,
  warnings: [],
  nodes: [
    { id: 'plan', parentId: null, label: 'Launch plan', summary: '', sourceIds: ['page'] },
    { id: 'scope', parentId: 'plan', label: 'Scope', summary: 'What ships first.', sourceIds: ['block-1'] },
  ],
};
const handlers = () => ({ canGenerate: false, onGenerate: jest.fn(), onSlides: jest.fn(), onSource: jest.fn() });

test('a presented map draws on the presentation surface instead of opening a second dialog', () => {
  const onClosePresentation = jest.fn();

  render(<MindMapViewer map={map} {...handlers()} onClosePresentation={onClosePresentation} />);

  expect(screen.getByRole('region', { name: 'Interactive mind map' })).toBeTruthy();
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Close enlarged mind map' }));
  expect(onClosePresentation).toHaveBeenCalled();
});

test('enlarging a map shown in the studio still opens it full screen above the page', () => {
  render(<MindMapViewer map={map} {...handlers()} />);

  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /Enlarge mind map/ }));
  expect(screen.getByRole('dialog')).toBeTruthy();
});

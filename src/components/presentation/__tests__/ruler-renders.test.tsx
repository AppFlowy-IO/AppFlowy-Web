import { fireEvent, render, screen } from '@testing-library/react';
import * as React from 'react';

import DocumentPresenter from '../DocumentPresenter';
import { parseMarkdown } from '../source';

import type { SourceBlock } from '../types';

const mockRenders = new Map<string, number>();
let mockDatabaseSource: ((id: string) => void) | undefined;

jest.mock('../SourceText', () => ({
  __esModule: true,
  default: ({ block }: { block: SourceBlock }) => {
    mockRenders.set(block.id, (mockRenders.get(block.id) ?? 0) + 1);
    return <>{block.text}</>;
  },
}));
jest.mock('../DocumentDatabase', () => ({
  __esModule: true,
  default: ({ onSource }: { onSource: (id: string) => void }) => {
    mockDatabaseSource = onSource;
    return <div>Linked database</div>;
  },
}));
jest.mock('../DocumentContentProvider', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));
jest.mock('@mui/material/Dialog', () => ({
  __esModule: true,
  default: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

beforeAll(() => {
  global.ResizeObserver = class {
    observe = jest.fn();
    unobserve = jest.fn();
    disconnect = jest.fn();
  } as unknown as typeof ResizeObserver;
});
beforeEach(() => {
  mockRenders.clear();
  mockDatabaseSource = undefined;
});

const next = () => fireEvent.keyDown(window, { key: 'ArrowRight' });

test('changing slides and host renders do not re-render the hidden measuring copy', () => {
  const snapshot = parseMarkdown('Alpha\n---\nBeta\n---\nGamma');
  const gamma = snapshot.blocks.find((block) => block.text === 'Gamma')!.id;
  const presenter = () => <DocumentPresenter snapshot={snapshot} onClose={() => undefined} onSource={() => undefined} />;
  const { rerender } = render(presenter());

  // Only the ruler renders the final section until its slide is shown.
  expect(mockRenders.get(gamma)).toBe(1);
  next();
  expect(screen.getByRole('main').textContent).toBe('Alpha');
  next();
  expect(screen.getByRole('main').textContent).toBe('Beta');
  // Hosts pass fresh close/source closures on every render.
  rerender(presenter());
  expect(mockRenders.get(gamma)).toBe(1);
  next();
  expect(screen.getByRole('main').textContent).toBe('Gamma');
  expect(mockRenders.get(gamma)).toBe(2);
});

test('slide content receives a stable source callback that follows the latest host handler', async () => {
  const snapshot = parseMarkdown('');

  snapshot.blocks.push({ id: 'embed', type: 'grid', text: '', children: [], database: { viewIds: ['view'] } });
  const first = jest.fn();
  const second = jest.fn();
  const { rerender } = render(<DocumentPresenter snapshot={snapshot} onClose={() => undefined} onSource={first} />);

  next();
  await screen.findByText('Linked database');
  const stable = mockDatabaseSource;

  rerender(<DocumentPresenter snapshot={snapshot} onClose={() => undefined} onSource={second} />);
  expect(mockDatabaseSource).toBe(stable);
  mockDatabaseSource!('embed');
  expect(second).toHaveBeenCalledWith('embed');
  expect(first).not.toHaveBeenCalled();
});

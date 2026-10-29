import { render, screen } from '@testing-library/react';
import * as React from 'react';

import DocumentPresenter from '../DocumentPresenter';
import { parseMarkdown } from '../source';

import type { SourceBlock } from '../types';

jest.mock('../SourceText', () => ({
  __esModule: true,
  default: ({ block }: { block: SourceBlock }) => <>{block.text}</>,
}));
jest.mock('../DocumentDatabase', () => ({ __esModule: true, default: () => <div>Linked database</div> }));
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

test('a slide is the scroll container embedded databases measure against, even when nothing overflows', () => {
  render(
    <DocumentPresenter snapshot={parseMarkdown('Short slide')} onClose={() => undefined} onSource={() => undefined} />
  );

  const slide = screen.getByRole('main', { name: /^Slide 1 of/ });

  // Grids find their scroller with closest('.appflowy-scroll-container') before falling back to an
  // ancestor whose content overflows; a short slide has none.
  expect(slide.classList.contains('appflowy-scroll-container')).toBe(true);
});

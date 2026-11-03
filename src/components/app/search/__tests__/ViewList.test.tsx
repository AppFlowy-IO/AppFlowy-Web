import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { fireEvent, render, screen } from '@testing-library/react';

import { ViewLayout } from '@/application/types';
import type { View } from '@/application/types';

import ViewList, { type SearchViewListItem } from '../ViewList';

const mockToView = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { defaultValue?: string }) =>
      ({ 'commandPalette.foundInImage': 'Found in an image', 'commandPalette.foundInPdf': 'Found in a PDF' }[key] ??
      options?.defaultValue ??
      key),
  }),
}));

jest.mock('@/components/app/app.hooks', () => ({
  useAppOutline: () => [],
  useToView: () => mockToView,
}));

jest.mock('@/components/_shared/view-icon/PageIcon', () => ({
  __esModule: true,
  default: () => <span />,
}));

jest.mock('@/components/_shared/image-render/ImageRender', () => ({
  ImageRender: ({ src, onError }: { src: string; onError?: () => void }) => (
    <img data-testid='evidence-thumbnail' src={src} alt='' onError={onError} />
  ),
}));

function view(overrides: Partial<View> = {}): View {
  return {
    view_id: 'page-id',
    name: 'Launch plan',
    icon: null,
    layout: ViewLayout.Document,
    extra: null,
    children: [],
    is_published: false,
    is_private: false,
    ...overrides,
  };
}

function renderList(items: SearchViewListItem[], onClose = jest.fn()) {
  render(<ViewList title='Best matches' items={items} loading={false} query='revenue' onClose={onClose} />);
  return onClose;
}

const imageResult: SearchViewListItem = {
  id: 'page-id:',
  view: view(),
  blockId: 'image-block',
  preview: 'Page text that is not shown',
  evidence: {
    kind: 'image',
    matchedText: 'Quarterly revenue chart',
    imageUrl: '/api/file_storage/workspace-id/v1/blob/page-id/chart.png',
  },
};

describe('ViewList', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // jsdom has no layout; the list scrolls the selected result into view.
    Element.prototype.scrollIntoView = jest.fn();
  });

  it('shows the matched image and its text instead of the page preview', () => {
    renderList([imageResult]);

    const evidence = screen.getByTestId('search-result-evidence');

    expect(evidence.getAttribute('data-kind')).toBe('image');
    expect(evidence.textContent).toContain('Found in an image');
    expect(evidence.textContent).toContain('Quarterly revenue chart');
    expect(screen.getByTestId('evidence-thumbnail').getAttribute('src')).toBe(imageResult.evidence?.imageUrl);
    expect(screen.queryByText('Page text that is not shown')).toBeNull();
  });

  it('shows the thumbnail of another matched image in the same page after one failed to load', () => {
    const list = (items: SearchViewListItem[]) => (
      <ViewList title='Best matches' items={items} loading={false} query='revenue' onClose={jest.fn()} />
    );
    const { rerender } = render(list([imageResult]));

    fireEvent.error(screen.getByTestId('evidence-thumbnail'));
    expect(screen.queryByTestId('evidence-thumbnail')).toBeNull();

    // A new query keeps the item for the same page mounted, and it matched a different image.
    const forecast = '/api/file_storage/workspace-id/v1/blob/page-id/forecast.png';

    rerender(list([{ ...imageResult, evidence: { kind: 'image', matchedText: 'Revenue forecast', imageUrl: forecast } }]));
    expect(screen.getByTestId('evidence-thumbnail').getAttribute('src')).toBe(forecast);
  });

  it('opens the page at the matched image when the result is clicked', () => {
    const onClose = renderList([imageResult]);

    fireEvent.click(screen.getByText('Launch plan'));

    expect(mockToView).toHaveBeenCalledWith('page-id', 'image-block');
    expect(onClose).toHaveBeenCalled();
  });

  it('opens the selected result at its block with the keyboard, and a row as a row', () => {
    const row: SearchViewListItem = {
      id: 'grid-id:row-id',
      view: view({ view_id: 'grid-id', name: 'Receipts', layout: ViewLayout.Grid }),
      rowId: 'row-id',
      evidence: { kind: 'pdf', matchedText: 'Fuel invoice' },
    };

    renderList([imageResult, row]);
    expect(screen.getAllByTestId('search-result-evidence')[1].textContent).toContain('Found in a PDF');

    fireEvent.keyDown(document, { key: 'Tab', keyCode: 9, which: 9 });
    fireEvent.keyDown(document, { key: 'Enter', keyCode: 13, which: 13 });
    expect(mockToView).toHaveBeenLastCalledWith('page-id', 'image-block');

    fireEvent.click(screen.getByText('Receipts'));
    expect(mockToView).toHaveBeenLastCalledWith('grid-id', 'row-id');
  });
});

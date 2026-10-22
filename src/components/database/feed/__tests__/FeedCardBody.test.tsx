import { act, fireEvent, render, screen } from '@testing-library/react';

import { FeedCardBody } from '../FeedCardBody';

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

describe('FeedCardBody', () => {
  const originalResizeObserver = globalThis.ResizeObserver;
  let resize: () => void = () => undefined;
  let contentHeight = 200;

  beforeEach(() => {
    contentHeight = 200;
    jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(() => contentHeight);
    jest.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockReturnValue(400);
    globalThis.ResizeObserver = class {
      constructor(callback: ResizeObserverCallback) {
        resize = () => callback([], this);
      }

      observe = jest.fn();
      unobserve = jest.fn();
      disconnect = jest.fn();
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
    globalThis.ResizeObserver = originalResizeObserver;
  });

  it('shows content as is while it fits under the card cap', () => {
    render(
      <FeedCardBody onOpenFullPage={jest.fn()} rowId='row-1'>
        <p>Short post</p>
      </FeedCardBody>
    );

    expect(screen.getByTestId('feed-card-body-row-1').getAttribute('data-clipped')).toBe('false');
    expect(screen.queryByTestId('feed-card-open-full-page-row-1')).toBeNull();
  });

  it('fades clipped content and offers Open as full page once the content outgrows the card', () => {
    const onOpenFullPage = jest.fn();

    render(
      <FeedCardBody onOpenFullPage={onOpenFullPage} rowId='row-1'>
        <p>Long post</p>
      </FeedCardBody>
    );

    contentHeight = 900;
    act(() => resize());

    const body = screen.getByTestId('feed-card-body-row-1');

    expect(body.getAttribute('data-clipped')).toBe('true');
    expect((body.firstElementChild as HTMLElement).style.maskImage).toContain('linear-gradient');

    const button = screen.getByTestId('feed-card-open-full-page-row-1');

    expect(button.textContent).toBe('grid.rowPage.openAsFullPage');
    fireEvent.click(button);
    expect(onOpenFullPage).toHaveBeenCalledTimes(1);
  });

  it('clips without a full-page button where the row cannot be opened as a page', () => {
    contentHeight = 900;
    render(
      <FeedCardBody rowId='row-1'>
        <p>Long post</p>
      </FeedCardBody>
    );

    expect(screen.getByTestId('feed-card-body-row-1').getAttribute('data-clipped')).toBe('true');
    expect(screen.queryByTestId('feed-card-open-full-page-row-1')).toBeNull();
  });
});

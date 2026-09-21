import { act, fireEvent, render, screen } from '@testing-library/react';
import { ComponentProps } from 'react';

import { CoverType, ViewIconType, ViewLayout, ViewMetaProps } from '@/application/types';

import { ViewMetaPreview } from '../ViewMetaPreview';

const mockAddIconCover = jest.fn();
const mockIconPicker = jest.fn();
const mockCover = jest.fn();

// The shared manual mock invokes debounced callbacks immediately; this regression
// needs the production debounce/flush behavior when TitleEditable unmounts.
jest.mock('lodash-es', () => jest.requireActual('lodash'));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/components/_shared/view-icon/PageIcon', () => () => null);
jest.mock('@/components/_shared/notify', () => ({ notify: { error: jest.fn() } }));
jest.mock('@/components/_shared/cutsom-icon', () => ({
  CustomIconPopover: (props: ComponentProps<typeof import('@/components/_shared/cutsom-icon').CustomIconPopover>) => {
    mockIconPicker(props);
    return (
      <div data-testid='icon-picker' data-enabled={props.enable}>
        {props.children}
      </div>
    );
  },
}));
jest.mock('@/components/view-meta/ViewCover', () => ({
  __esModule: true,
  default: (props: ComponentProps<typeof import('../ViewCover').default>) => {
    mockCover(props);
    return <div data-testid='cover' data-readonly={props.readOnly} />;
  },
}));
jest.mock('@/components/view-meta/AddIconCover', () => ({
  __esModule: true,
  default: (props: ComponentProps<typeof import('../AddIconCover').default>) => {
    mockAddIconCover(props);
    return <div data-testid='add-icon-cover' />;
  },
}));

const baseProps: ViewMetaProps = {
  viewId: 'source-page',
  name: 'Original title',
  layout: ViewLayout.Document,
};

describe('ViewMetaPreview read-only transitions', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
  });

  afterEach(() => jest.useRealTimers());

  it('blocks the real title editor from flushing a pending rename when ownership becomes read-only', async () => {
    const updatePageName = jest.fn().mockResolvedValue(undefined);
    const { container, rerender } = render(
      <ViewMetaPreview {...baseProps} readOnly={false} updatePageName={updatePageName} />
    );

    await act(async () => {
      await Promise.resolve();
    });
    const title = screen.getByTestId('page-title-input');

    title.textContent = 'Pending local title';
    fireEvent.input(title);
    expect(updatePageName).not.toHaveBeenCalled();

    rerender(<ViewMetaPreview {...baseProps} readOnly={true} updatePageName={updatePageName} />);
    await act(async () => {
      jest.advanceTimersByTime(3_000);
    });

    expect(updatePageName).not.toHaveBeenCalled();
    expect(screen.queryByTestId('page-title-input')).toBeNull();
    expect(container.querySelector('[contenteditable="true"]')).toBeNull();
    expect(screen.getByText('Original title').getAttribute('contenteditable')).toBe('false');
    expect(screen.queryByTestId('add-icon-cover')).toBeNull();
  });

  it('still saves an ordinary editable page title after its debounce', async () => {
    const updatePageName = jest.fn().mockResolvedValue(undefined);

    render(<ViewMetaPreview {...baseProps} readOnly={false} updatePageName={updatePageName} />);
    const title = screen.getByTestId('page-title-input');

    title.textContent = 'Updated title';
    fireEvent.input(title);
    await act(async () => {
      jest.advanceTimersByTime(3_000);
    });

    expect(updatePageName).toHaveBeenCalledTimes(1);
    expect(updatePageName).toHaveBeenCalledWith('source-page', 'Updated title');
    expect(screen.getByTestId('page-title-input').getAttribute('contenteditable')).toBe('true');
  });

  it('disables metadata controls and rejects callbacks retained by an open picker after editing is revoked', async () => {
    const updatePage = jest.fn().mockResolvedValue(undefined);
    const updatePageIcon = jest.fn().mockResolvedValue(undefined);
    const uploadFile = jest.fn().mockResolvedValue('https://example.com/uploaded.png');
    const props: ViewMetaProps = {
      ...baseProps,
      icon: { ty: ViewIconType.Emoji, value: '📚' },
      cover: { type: CoverType.NormalColor, value: '#ffffff', offset: 0 },
      updatePage,
      updatePageIcon,
      uploadFile,
    };
    const { rerender } = render(<ViewMetaPreview {...props} readOnly={false} />);

    await act(async () => {
      await Promise.resolve();
    });
    const addControls = mockAddIconCover.mock.calls[mockAddIconCover.mock.calls.length - 1][0];
    const iconPicker = mockIconPicker.mock.calls[mockIconPicker.mock.calls.length - 1][0];
    const cover = mockCover.mock.calls[mockCover.mock.calls.length - 1][0];

    expect(screen.getByTestId('add-icon-cover')).toBeTruthy();
    expect(screen.getByTestId('icon-picker').getAttribute('data-enabled')).toBe('true');
    rerender(<ViewMetaPreview {...props} readOnly={true} />);

    expect(screen.queryByTestId('add-icon-cover')).toBeNull();
    expect(screen.getByTestId('icon-picker').getAttribute('data-enabled')).toBe('false');
    expect(screen.getByTestId('cover').getAttribute('data-readonly')).toBe('true');
    await act(async () => {
      await addControls.onUpdateIcon({ ty: ViewIconType.Emoji, value: '📝' });
      addControls.onAddCover();
      iconPicker.onSelectIcon({ ty: ViewIconType.Emoji, value: '📝' });
      iconPicker.removeIcon();
      await cover.onUpdateCover({ type: CoverType.NormalColor, value: '#000000', offset: 0 });
      await cover.onRemoveCover();
      await expect(addControls.onUploadFile(new File(['image'], 'cover.png'))).rejects.toBeUndefined();
    });

    expect(updatePage).not.toHaveBeenCalled();
    expect(updatePageIcon).not.toHaveBeenCalled();
    expect(uploadFile).not.toHaveBeenCalled();
  });
});

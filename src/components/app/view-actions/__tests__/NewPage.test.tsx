import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { ViewLayout } from '@/application/types';
import NewPage from '@/components/app/view-actions/NewPage';

import type { CreatePagePayload } from '@/application/types';
import type { ReactNode } from 'react';

const mockAddPage = jest.fn();
const mockCreateSpaceWithInitialPage = jest.fn();
const mockOpenPageModal = jest.fn();
const mockEnsureViewVisibleInOutline = jest.fn();
let mockOutline: Array<{
  view_id: string;
  name: string;
  extra: Record<string, never>;
  is_private: boolean;
  children: never[];
}> = [];
let lastCreateSpaceProps:
  | {
      initialPage?: CreatePagePayload;
      onClose: () => void;
      onCreated?: (spaceId: string, pageId?: string) => void;
    }
  | undefined;

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@mui/material', () => ({
  Button: ({ children, ...props }: { children: ReactNode; [key: string]: unknown }) => (
    <button {...props}>{children}</button>
  ),
}));

jest.mock('@/components/_shared/modal', () => ({
  NormalModal: ({
    children,
    open,
    onClose,
    onOk,
    okButtonProps,
    ...props
  }: {
    children: ReactNode;
    open: boolean;
    onClose: () => void;
    onOk?: () => void;
    okButtonProps?: { disabled?: boolean };
    [key: string]: unknown;
  }) =>
    open ? (
      <div data-testid={props['data-testid'] as string | undefined}>
        <button data-testid='new-page-modal-close' onClick={onClose}>
          close
        </button>
        <button data-testid='new-page-modal-ok' disabled={okButtonProps?.disabled} onClick={onOk}>
          ok
        </button>
        {children}
      </div>
    ) : null,
}));

jest.mock('@/components/_shared/notify', () => ({
  notify: { error: jest.fn() },
}));

jest.mock('@/components/app/app.hooks', () => ({
  useAppOperations: () => ({
    addPage: mockAddPage,
    createSpaceWithInitialPage: mockCreateSpaceWithInitialPage,
  }),
  useAppOutline: () => mockOutline,
  useEnsureViewVisibleInOutline: () => mockEnsureViewVisibleInOutline,
  useOpenPageModal: () => mockOpenPageModal,
}));

jest.mock('@/components/publish/header/duplicate/SpaceList', () => ({
  __esModule: true,
  default: ({ title, onChange }: { title: ReactNode; onChange: (spaceId: string) => void }) => (
    <div data-testid='space-list'>
      {title}
      <button data-testid='select-existing-space' onClick={() => onChange('space-existing')}>
        select
      </button>
    </div>
  ),
}));

jest.mock('@/components/app/view-actions/CreateSpaceModal', () => ({
  __esModule: true,
  default: ({
    open,
    initialPage,
    onClose,
    onCreated,
  }: {
    open: boolean;
    initialPage?: CreatePagePayload;
    onClose: () => void;
    onCreated?: (spaceId: string, pageId?: string) => void;
  }) => {
    lastCreateSpaceProps = { initialPage, onClose, onCreated };

    return open ? (
      <div data-testid='create-space-draft-panel'>
        <button data-testid='create-space-draft-close' onClick={onClose}>
          close draft
        </button>
        <button data-testid='create-space-draft-complete' onClick={() => onCreated?.('space-created', 'page-created')}>
          complete draft
        </button>
      </div>
    ) : null;
  },
}));

describe('NewPage create-space flow', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockOutline = [];
    lastCreateSpaceProps = undefined;
    mockEnsureViewVisibleInOutline.mockResolvedValue([]);
  });

  function openCreateSpaceFlow() {
    fireEvent.click(screen.getByTestId('new-page-button'));
    fireEvent.click(screen.getByTestId('new-page-create-space-button'));
  }

  it('opens the draft Create Space panel without creating anything from the chooser link', () => {
    render(<NewPage />);

    openCreateSpaceFlow();

    expect(screen.getByTestId('create-space-draft-panel')).toBeTruthy();
    expect(screen.queryByTestId('new-page-modal')).toBeNull();
    expect(lastCreateSpaceProps?.initialPage).toEqual({ layout: ViewLayout.Document });
    expect(mockCreateSpaceWithInitialPage).not.toHaveBeenCalled();
  });

  it('hydrates the exact created child before opening it when creation wins the outline race', async () => {
    const hydration = deferred<string[]>();

    mockEnsureViewVisibleInOutline.mockReturnValue(hydration.promise);
    render(<NewPage />);

    openCreateSpaceFlow();
    expect(mockOpenPageModal).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('create-space-draft-complete'));

    expect(mockEnsureViewVisibleInOutline).toHaveBeenCalledWith('page-created');
    expect(mockOpenPageModal).not.toHaveBeenCalled();
    await act(async () => {
      hydration.resolve(['space-created']);
      await hydration.promise;
    });

    await waitFor(() => expect(mockOpenPageModal).toHaveBeenCalledTimes(1));
    expect(mockOpenPageModal).toHaveBeenCalledTimes(1);
    expect(mockOpenPageModal).toHaveBeenCalledWith('page-created');
    expect(screen.queryByTestId('create-space-draft-panel')).toBeNull();
  });

  it('discards a draft without opening a page', () => {
    render(<NewPage />);

    openCreateSpaceFlow();
    fireEvent.click(screen.getByTestId('create-space-draft-close'));

    expect(screen.queryByTestId('create-space-draft-panel')).toBeNull();
    expect(screen.queryByTestId('new-page-modal')).toBeNull();
    expect(mockOpenPageModal).not.toHaveBeenCalled();
    expect(mockCreateSpaceWithInitialPage).not.toHaveBeenCalled();
  });

  it('adds a page to an existing space without opening the create controller', async () => {
    mockAddPage.mockResolvedValue({ view_id: 'existing-space-page' });
    mockOutline = [
      {
        view_id: 'space-existing',
        name: 'Existing',
        extra: {},
        is_private: false,
        children: [],
      },
    ];
    render(<NewPage />);

    fireEvent.click(screen.getByTestId('new-page-button'));
    fireEvent.click(screen.getByTestId('select-existing-space'));
    fireEvent.click(screen.getByTestId('new-page-modal-ok'));

    await act(async () => undefined);
    expect(mockAddPage).toHaveBeenCalledWith('space-existing', {
      layout: ViewLayout.Document,
      prev_view_id: undefined,
    });
    expect(mockOpenPageModal).toHaveBeenCalledWith('existing-space-page');
    expect(screen.queryByTestId('new-page-modal')).toBeNull();
    expect(mockCreateSpaceWithInitialPage).not.toHaveBeenCalled();
  });

  it('blocks the create-draft link while adding an existing page', async () => {
    const addition = deferred<{ view_id: string }>();

    mockAddPage.mockReturnValue(addition.promise);
    mockOutline = [
      {
        view_id: 'space-existing',
        name: 'Existing',
        extra: {},
        is_private: false,
        children: [],
      },
    ];
    render(<NewPage />);

    fireEvent.click(screen.getByTestId('new-page-button'));
    fireEvent.click(screen.getByTestId('select-existing-space'));
    fireEvent.click(screen.getByTestId('new-page-modal-ok'));
    const createButton = screen.getByTestId('new-page-create-space-button');

    expect(createButton.getAttribute('disabled')).not.toBeNull();
    fireEvent.click(createButton);
    expect(screen.queryByTestId('create-space-draft-panel')).toBeNull();

    await act(async () => {
      addition.resolve({ view_id: 'existing-space-page' });
      await addition.promise;
    });
  });
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';

import en from '@/@types/translations/en.json';
import fr from '@/@types/translations/fr-FR.json';
import { PublishContext, PublishContextType } from '@/application/publish';
import { PublishService } from '@/application/services/domains';
import { Types, ViewLayout } from '@/application/types';
import { notify } from '@/components/_shared/notify';

import DuplicateModal, { getCollabTypeFromViewLayout } from './DuplicateModal';

import type { ReactNode } from 'react';

jest.mock('@/application/services/domains', () => ({
  PublishService: { duplicate: jest.fn() },
}));

jest.mock('@/components/_shared/notify', () => ({
  notify: { error: jest.fn(), success: jest.fn() },
}));

// A workspace and a space are already chosen, so the Add button is live.
jest.mock('@/components/publish/header/duplicate/useDuplicate', () => ({
  useLoadWorkspaces: () => ({
    workspaceList: [],
    spaceList: [],
    selectedWorkspaceId: 'workspace-1',
    selectedSpaceId: 'space-1',
    setSelectedWorkspaceId: jest.fn(),
    setSelectedSpaceId: jest.fn(),
    workspaceLoading: false,
    spaceLoading: false,
    spaceError: false,
    loadWorkspaces: jest.fn(),
    loadSpaces: jest.fn(),
  }),
}));

jest.mock('@/components/publish/header/duplicate/SelectWorkspace', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/publish/header/duplicate/SpaceList', () => ({ __esModule: true, default: () => null }));

jest.mock('@/components/_shared/modal', () => ({
  NormalModal: ({
    children,
    open,
    onOk,
    okText,
    okButtonProps,
    title,
  }: {
    children: ReactNode;
    open: boolean;
    onOk?: () => void;
    okText?: ReactNode;
    okButtonProps?: { disabled?: boolean };
    title: ReactNode;
  }) =>
    open ? (
      <div>
        <div>{title}</div>
        <button disabled={okButtonProps?.disabled} onClick={onOk}>
          {okText}
        </button>
        {children}
      </div>
    ) : null,
}));

type Translations = { publish: Record<string, string | undefined> };

const TOO_LARGE = 'This page is too large to duplicate at once. Try duplicating a smaller page, or copy it in parts.';

describe('getCollabTypeFromViewLayout', () => {
  it.each([
    ViewLayout.Grid,
    ViewLayout.Board,
    ViewLayout.Calendar,
    ViewLayout.Chart,
    ViewLayout.List,
    ViewLayout.Gallery,
    ViewLayout.Form,
  ])('maps database layout %s to the database collab type', (layout) => {
    expect(getCollabTypeFromViewLayout(layout)).toBe(Types.Database);
  });

  it('maps document layouts to the document collab type', () => {
    expect(getCollabTypeFromViewLayout(ViewLayout.Document)).toBe(Types.Document);
  });

  it('rejects unsupported layouts', () => {
    expect(getCollabTypeFromViewLayout(ViewLayout.AIChat)).toBeNull();
  });
});

describe('DuplicateModal', () => {
  const duplicate = PublishService.duplicate as jest.Mock;
  const i18n = createInstance();

  beforeAll(async () => {
    await i18n.init({ lng: 'en', resources: { en: { translation: en } }, interpolation: { escapeValue: false } });
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  function renderModal() {
    const onClose = jest.fn();
    const context = { viewMeta: { view_id: 'view-1', layout: ViewLayout.Document } } as unknown as PublishContextType;

    render(
      <I18nextProvider i18n={i18n}>
        <PublishContext.Provider value={context}>
          <DuplicateModal open onClose={onClose} />
        </PublishContext.Provider>
      </I18nextProvider>
    );

    return { onClose };
  }

  async function addAndFail() {
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await waitFor(() => expect(notify.error).toHaveBeenCalledTimes(1));
  }

  it('says when the page is too large to duplicate at once, and what to try, without server text', async () => {
    const serverText = 'Payload too large: published duplicate exceeds 52428800 bytes';

    duplicate.mockRejectedValue({ code: 1016, message: serverText, httpStatus: 413 });
    const { onClose } = renderModal();

    await addAndFail();

    expect(notify.error).toHaveBeenCalledWith(TOO_LARGE);
    expect(notify.error).not.toHaveBeenCalledWith(expect.stringContaining(serverText));
    expect(onClose).not.toHaveBeenCalled();
    // The failure changes only the message, not the request.
    expect(duplicate).toHaveBeenCalledWith({
      workspaceId: 'workspace-1',
      spaceViewId: 'space-1',
      viewId: 'view-1',
      collabType: Types.Document,
    });
  });

  it('reads a bare HTTP 413 from a proxy, which carries no AppFlowy code, the same way', async () => {
    duplicate.mockRejectedValue({ code: 413, message: '<html>413 Request Entity Too Large</html>', httpStatus: 413 });
    renderModal();

    await addAndFail();

    expect(notify.error).toHaveBeenCalledWith(TOO_LARGE);
  });

  it('keeps the generic failure for other errors and never shows their server text', async () => {
    duplicate.mockRejectedValue({ code: 1012, message: 'user 42 cannot write to workspace 7f3a', httpStatus: 403 });
    const { onClose } = renderModal();

    await addAndFail();

    expect(notify.error).toHaveBeenCalledWith('Duplicated failed');
    expect(onClose).not.toHaveBeenCalled();
  });

  it('has its own French copy for the size limit', () => {
    const english = (en as unknown as Translations).publish.duplicateTooLarge;
    const french = (fr as unknown as Translations).publish.duplicateTooLarge;

    expect(english).toBe(TOO_LARGE);
    expect(french).toBeTruthy();
    expect(french).not.toBe(english);
  });
});

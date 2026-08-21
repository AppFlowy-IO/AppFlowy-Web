import { act, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import * as Y from 'yjs';

import { ViewLayout, type View } from '@/application/types';

const modalViewId = '00000000-0000-4000-8000-000000000001';
const mockView: View = {
  view_id: modalViewId,
  name: 'Modal page',
  icon: null,
  layout: ViewLayout.Document,
  extra: null,
  children: [],
  is_published: false,
  is_private: false,
};
const mockLoadView = jest.fn();
const mockBindViewSync = jest.fn();
const mockNoop = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/application/services/domains', () => ({
  ViewService: {
    get: jest.fn(),
  },
  WorkspaceService: {
    searchMentions: jest.fn(),
  },
}));

jest.mock('@/application/services/js-services/http', () => ({
  getAxiosInstance: jest.fn(() => null),
}));

jest.mock('@/components/app/app.hooks', () => ({
  useAppOperations: () => ({
    toView: mockNoop,
    loadViewMeta: mockNoop,
    createRow: mockNoop,
    loadView: mockLoadView,
    bindViewSync: mockBindViewSync,
    updatePage: mockNoop,
    addPage: mockNoop,
    deletePage: mockNoop,
    setWordCount: mockNoop,
    uploadFile: mockNoop,
  }),
  useAppOutline: () => [mockView],
  useCurrentWorkspaceId: () => 'workspace-id',
  useEventEmitter: () => undefined,
  useGetMentionUser: () => mockNoop,
  useLoadDatabaseRelations: () => mockNoop,
  useLoadViews: () => mockNoop,
  useOpenPageModal: () => mockNoop,
  useScheduleDeferredCleanup: () => mockNoop,
}));

jest.mock('@/components/app/hooks/useViewOperations', () => ({
  getViewCanCommentStatus: () => true,
  getViewCanWriteStatus: () => true,
  useViewOperations: () => ({
    getViewReadOnlyStatus: () => false,
  }),
}));

jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUser: () => ({ email: 'user@example.com' }),
}));

jest.mock('@/components/document', () => ({
  Document: ({ doc }: { doc: Y.Doc }) => <div data-testid='modal-doc'>{doc.guid}</div>,
}));

jest.mock('@/components/app/DatabaseView', () => ({
  __esModule: true,
  default: ({ doc }: { doc: Y.Doc }) => <div data-testid='modal-doc'>{doc.guid}</div>,
}));

jest.mock('@/components/app/header/MoreActions', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/app/view-actions/MovePagePopover', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => children,
}));

jest.mock('@/components/_shared/view-icon/SpaceIcon', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/app/share/ShareButton', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/app/header/Users', () => ({
  Users: () => null,
}));

jest.mock('@/components/error/RecordNotFound', () => ({
  __esModule: true,
  default: () => null,
}));

import ViewModal from '@/components/app/ViewModal';

describe('ViewModal permission cleanup', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('drops a loaded Y.Doc when a security close bypasses handleClose', async () => {
    const firstDoc = new Y.Doc({ guid: 'revoked-doc' });
    const replacementDoc = new Y.Doc({ guid: 'replacement-doc' });
    let resolveReplacement: ((doc: Y.Doc) => void) | undefined;
    const replacementPromise = new Promise<Y.Doc>((resolve) => {
      resolveReplacement = resolve;
    });

    mockLoadView.mockResolvedValueOnce(firstDoc).mockReturnValueOnce(replacementPromise);

    const { rerender } = render(<ViewModal viewId={modalViewId} open={true} onClose={mockNoop} />);

    await screen.findByText('revoked-doc');

    // AppBusinessLayer closes revoked modals by changing the controlled prop;
    // it intentionally cannot call ViewModal.handleClose directly.
    rerender(<ViewModal viewId={modalViewId} open={false} onClose={mockNoop} />);
    expect(screen.queryByTestId('modal-doc')).toBeNull();

    rerender(<ViewModal viewId={modalViewId} open={true} onClose={mockNoop} />);
    expect(screen.queryByText('revoked-doc')).toBeNull();

    resolveReplacement?.(replacementDoc);
    await waitFor(() => expect(screen.getByText('replacement-doc')).toBeTruthy());
  });

  it('ignores a modal load that resolves after a security close', async () => {
    const revokedDoc = new Y.Doc({ guid: 'late-revoked-doc' });
    const replacementDoc = new Y.Doc({ guid: 'replacement-doc' });
    let resolveRevoked: ((doc: Y.Doc) => void) | undefined;
    let resolveReplacement: ((doc: Y.Doc) => void) | undefined;
    const revokedPromise = new Promise<Y.Doc>((resolve) => {
      resolveRevoked = resolve;
    });
    const replacementPromise = new Promise<Y.Doc>((resolve) => {
      resolveReplacement = resolve;
    });

    mockLoadView.mockReturnValueOnce(revokedPromise).mockReturnValueOnce(replacementPromise);

    const { rerender } = render(<ViewModal viewId={modalViewId} open={true} onClose={mockNoop} />);

    await waitFor(() => expect(mockLoadView).toHaveBeenCalledTimes(1));
    rerender(<ViewModal viewId={modalViewId} open={false} onClose={mockNoop} />);

    await act(async () => {
      resolveRevoked?.(revokedDoc);
      await revokedPromise;
    });
    expect(screen.queryByText('late-revoked-doc')).toBeNull();

    rerender(<ViewModal viewId={modalViewId} open={true} onClose={mockNoop} />);
    expect(screen.queryByText('late-revoked-doc')).toBeNull();

    await act(async () => {
      resolveReplacement?.(replacementDoc);
      await replacementPromise;
    });
    await waitFor(() => expect(screen.getByText('replacement-doc')).toBeTruthy());
  });
});

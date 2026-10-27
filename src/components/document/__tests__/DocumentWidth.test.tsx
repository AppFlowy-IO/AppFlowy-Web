import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as Y from 'yjs';

import { ViewComponentProps, ViewLayout, YjsEditorKey } from '@/application/types';
import Document from '@/components/document/Document';
import { Editor } from '@/components/editor';
import ViewMetaPreview from '@/components/view-meta/ViewMetaPreview';

jest.mock('@/application/awareness', () => ({
  generateUserColors: jest.fn(),
  useDispatchUserAwareness: () => jest.fn(),
  useDispatchCursorAwareness: () => jest.fn(),
  useDispatchClearAwareness: () => ({ clearAwareness: jest.fn(), clearCursor: jest.fn() }),
}));
jest.mock('@/application/services/domains', () => ({ CollabService: {} }));
jest.mock('@/application/slate-yjs/utils/yjs', () => ({ appendFirstEmptyParagraph: jest.fn() }));
jest.mock('@/application/user-metadata', () => ({ getUserIconUrl: () => '' }));
jest.mock('@/components/app/app.hooks', () => ({ useAppAwareness: () => undefined }));
jest.mock('@/components/app/useWorkspaceMemberProfile', () => ({ useCurrentUserWorkspaceAvatar: () => undefined }));
jest.mock('@/components/main/app.hooks', () => ({ useCurrentUser: () => undefined }));
jest.mock('@/components/editor', () => ({
  Editor: jest.fn(() => <div data-testid='editor' />),
}));
jest.mock('@/components/view-meta/ViewMetaPreview', () => ({
  __esModule: true,
  default: jest.fn(() => <div data-testid='title' />),
}));

describe('synchronized document width', () => {
  let doc: Y.Doc;

  beforeEach(() => {
    jest.clearAllMocks();
    doc = new Y.Doc();
    doc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.document, new Y.Map());
  });

  afterEach(() => doc.destroy());

  function page(extra: Record<string, unknown> = {}) {
    const props = {
      doc,
      workspaceId: 'workspace',
      readOnly: false,
      viewMeta: { viewId: 'document', name: 'Shared document', layout: ViewLayout.Document, extra },
    } as ViewComponentProps;

    return <MemoryRouter><Document {...props} /></MemoryRouter>;
  }

  const titleProps = () => (ViewMetaPreview as jest.Mock).mock.calls.slice(-1)[0][0];
  const editorProps = () => (Editor as jest.Mock).mock.calls.slice(-1)[0][0];

  it('applies full width from desktop metadata to the title and editor', () => {
    render(page({ document_width: { mode: 'full' } }));

    expect(titleProps().maxWidth).toBeUndefined();
    expect(editorProps().fullWidth).toBe(true);
  });

  it('reacts to a fixed width and reset without reopening the document', () => {
    const { rerender } = render(page({ document_width: { mode: 'full' } }));

    rerender(page({ document_width: { mode: 'fixed', max_width: 960 } }));

    expect(titleProps().maxWidth).toBe(960);
    expect(screen.getByTestId('editor').parentElement?.style.maxWidth).toBe('960px');
    expect(editorProps().fullWidth).toBe(true);

    rerender(page());
    expect(titleProps().maxWidth).toBe(952);
    expect(editorProps().fullWidth).toBeFalsy();
    expect(screen.getByTestId('editor').parentElement?.style.maxWidth).toBe('');
  });

  it.each([null, 'full', { mode: 'future' }, { mode: 'fixed', max_width: -1 }, { mode: 'fixed', max_width: '960' }])(
    'keeps the existing layout for invalid or unsupported width %p',
    (document_width) => {
      render(page({ document_width }));
      expect(titleProps().maxWidth).toBe(952);
      expect(editorProps().fullWidth).toBeFalsy();
    }
  );
});

import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ReactNode } from 'react';
import { createEditor, Element } from 'slate';

import { createLinkedDefaultDatabaseView } from '@/application/database-yjs/creation/create-linked-default-view';
import { withYjs, YjsEditor } from '@/application/slate-yjs';
import { withTestingYDoc } from '@/application/slate-yjs/__tests__/withTestingYjsEditor';
import { slateContentInsertToYData } from '@/application/slate-yjs/utils/convert';
import { BlockType, CollabOrigin, ViewLayout, YjsEditorKey } from '@/application/types';
import { notify } from '@/components/_shared/notify';
import { EditorContextState } from '@/components/editor/EditorContext';

import ControlsMenu from '../ControlsMenu';

let mockEditor: YjsEditor;
let mockContext: EditorContextState;
let mockSelectedBlockIds: string[];
const mockTranslate = (key: string) => key;

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: mockTranslate }) }));
jest.mock('slate-react', () => ({ ...jest.requireActual('slate-react'), useSlateStatic: () => mockEditor }));
jest.mock('@/components/editor/EditorContext', () => ({
  useEditorContext: () => mockContext,
  useEditorLocalState: () => ({ selectedBlockIds: mockSelectedBlockIds }),
}));
jest.mock('@/components/_shared/popover', () => ({
  Popover: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));
jest.mock('@/components/_shared/notify', () => ({ notify: { error: jest.fn(), success: jest.fn() } }));
jest.mock('@/application/database-yjs/creation/create-linked-default-view', () => ({
  createLinkedDefaultDatabaseView: jest.fn(),
}));

it.each([false, true])(
  'closing the menu preserves only the still-connected editor owner (disconnect: %s)',
  async (disconnect) => {
    jest.clearAllMocks();
    const doc = withTestingYDoc('document');

    slateContentInsertToYData(
      'document',
      0,
      [
        {
          type: BlockType.GridBlock,
          data: { parent_id: 'document', view_ids: ['source'], database_id: 'database' },
          children: [{ type: YjsEditorKey.text, children: [{ text: '' }] }],
        } as Element,
      ],
      doc
    );
    mockEditor = withYjs(createEditor(), doc, { readOnly: false, localOrigin: CollabOrigin.Local });
    mockEditor.connect();
    mockSelectedBlockIds = [mockEditor.children[0].blockId!];
    let resolveMetadata!: (value: unknown) => void;

    mockContext = {
      workspaceId: 'workspace',
      viewId: 'document',
      readOnly: false,
      loadViewMeta: jest.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveMetadata = resolve;
          })
      ),
    };
    jest.mocked(createLinkedDefaultDatabaseView).mockImplementation(async (intent) => {
      intent.assertCurrent?.();
      return { view_id: 'created', database_id: 'database' };
    });
    const menu = render(<ControlsMenu open anchorEl={null} onClose={() => menu.unmount()} />);

    try {
      fireEvent.click(screen.getByTestId('duplicate'));
      await waitFor(() => expect(mockContext.loadViewMeta).toHaveBeenCalledWith('source'));
      expect(screen.queryByTestId('controls-menu')).toBeNull();
      if (disconnect) mockEditor.disconnect();
      resolveMetadata({ view_id: 'source', parent_view_id: 'document', layout: ViewLayout.Grid });
      if (disconnect) {
        await waitFor(() => expect(notify.error).toHaveBeenCalled());
        expect(notify.success).not.toHaveBeenCalled();
      } else {
        await waitFor(() => expect(notify.success).toHaveBeenCalled());
        expect(mockEditor.children).toHaveLength(2);
        expect(mockEditor.children[1].data).toMatchObject({
          parent_id: 'document',
          view_ids: ['created'],
          database_id: 'database',
        });
        expect(notify.error).not.toHaveBeenCalled();
      }
    } finally {
      menu.unmount();
      mockEditor.disconnect();
      doc.destroy();
    }
  }
);

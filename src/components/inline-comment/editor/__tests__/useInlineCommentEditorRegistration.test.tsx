import { render } from '@testing-library/react';

import { YjsEditor } from '@/application/slate-yjs';

import { useInlineCommentEditorRegistration } from '../useInlineCommentEditorRegistration';

function createBridge() {
  const unregister = jest.fn();
  const bridge = {
    registerEditor: jest.fn(() => unregister),
  };

  return { bridge, unregister };
}

function RegistrationHarness({
  bridge,
  editor,
}: {
  bridge: ReturnType<typeof createBridge>['bridge'];
  editor: YjsEditor;
}) {
  useInlineCommentEditorRegistration(editor, bridge, {
    canComment: true,
    canWrite: true,
    readOnly: false,
    viewId: 'page-view',
  });

  return null;
}

describe('useInlineCommentEditorRegistration', () => {
  it('restores the mounted page editor when the provider scope changes back', () => {
    const editor = {} as YjsEditor;
    const modalScope = createBridge();
    const restoredPageScope = createBridge();
    const { rerender, unmount } = render(<RegistrationHarness bridge={modalScope.bridge} editor={editor} />);

    expect(modalScope.bridge.registerEditor).toHaveBeenCalledWith(editor, {
      canComment: true,
      canWrite: true,
      readOnly: false,
      viewId: 'page-view',
    });

    rerender(<RegistrationHarness bridge={restoredPageScope.bridge} editor={editor} />);

    expect(modalScope.unregister).toHaveBeenCalledTimes(1);
    expect(restoredPageScope.bridge.registerEditor).toHaveBeenCalledWith(editor, {
      canComment: true,
      canWrite: true,
      readOnly: false,
      viewId: 'page-view',
    });

    unmount();
    expect(restoredPageScope.unregister).toHaveBeenCalledTimes(1);
  });
});

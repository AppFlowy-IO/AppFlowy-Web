import { act, render } from '@testing-library/react';

import { RichTextCellEditor, usePreloadRichTextCellEditor } from '../load';
import CoreEditor from '../RichTextCellEditor';

const mockLoaded = jest.fn();

jest.mock('../RichTextCellEditor', () => ({ __esModule: true, default: jest.fn(() => null) }));
jest.mock('../RichTextCellEditorUI', () => {
  mockLoaded('ui');
  return { RichTextCellEditorControls: () => null };
});

function View({ editable }: { editable: boolean }) {
  usePreloadRichTextCellEditor(editable);
  return null;
}

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe('rich text cell code loading', () => {
  it('exports the input eagerly and preloads its optional menus once, only for editable views', async () => {
    expect(RichTextCellEditor).toBe(CoreEditor);
    const view = render(<View editable={false} />);

    await settle();
    expect(mockLoaded).not.toHaveBeenCalled();
    view.rerender(<View editable />);
    await settle();
    expect(mockLoaded.mock.calls).toEqual([['ui']]);
    view.rerender(<View editable={false} />);
    view.rerender(<View editable />);
    await settle();
    expect(mockLoaded).toHaveBeenCalledTimes(1);
  });
});

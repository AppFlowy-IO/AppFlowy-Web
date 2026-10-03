import { act, render } from '@testing-library/react';

import { usePreloadRichTextCellEditor } from '../load';

const mockLoaded = jest.fn();

jest.mock('../RichTextCellEditor', () => {
  mockLoaded('editor');
  return { __esModule: true, default: () => null };
});
jest.mock('../RichTextCellDocument', () => {
  mockLoaded('document');
  return { __esModule: true, default: () => null };
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

describe('rich text cell editor preload', () => {
  it('loads the editor when a view that can edit Text cells mounts, before any cell is edited', async () => {
    render(<View editable={false} />);
    await settle();
    expect(mockLoaded).not.toHaveBeenCalled();

    render(<View editable />);
    await settle();
    expect(mockLoaded).toHaveBeenCalledWith('editor');
    expect(mockLoaded).toHaveBeenCalledWith('document');
  });
});

import { fireEvent, render, screen } from '@testing-library/react';

import { EditorContextProvider, useEditorContext } from '../EditorContext';

function RowDocumentContextProbe() {
  const context = useEditorContext();

  return (
    <div
      data-testid='row-document-context'
      data-has-check={String(Boolean(context.checkIfRowDocumentExists))}
      data-has-create={String(Boolean(context.createRowDocument))}
      data-has-duplicate={String(Boolean(context.duplicateRowDocument))}
      data-has-load={String(Boolean(context.loadRowDocument))}
      data-has-sync-cleanup={String(Boolean(context.scheduleDeferredCleanup))}
      data-has-update={String(Boolean(context.updatePage))}
      data-content-padding={context.contentPadding}
      onClick={() => void context.updatePage?.('database-view-id', { name: 'Renamed view' })}
    />
  );
}

describe('EditorContextProvider', () => {
  it('preserves row document and page update operations for embedded databases', () => {
    const updatePage = jest.fn().mockResolvedValue(undefined);

    render(
      <EditorContextProvider
        workspaceId='workspace-id'
        viewId='view-id'
        readOnly={false}
        contentPadding='template'
        checkIfRowDocumentExists={jest.fn()}
        createRowDocument={jest.fn()}
        duplicateRowDocument={jest.fn()}
        loadRowDocument={jest.fn()}
        scheduleDeferredCleanup={jest.fn()}
        updatePage={updatePage}
      >
        <RowDocumentContextProbe />
      </EditorContextProvider>
    );

    const probe = screen.getByTestId('row-document-context');

    expect(probe.getAttribute('data-has-check')).toBe('true');
    expect(probe.getAttribute('data-has-create')).toBe('true');
    expect(probe.getAttribute('data-has-duplicate')).toBe('true');
    expect(probe.getAttribute('data-has-load')).toBe('true');
    expect(probe.getAttribute('data-has-sync-cleanup')).toBe('true');
    expect(probe.getAttribute('data-has-update')).toBe('true');
    expect(probe.getAttribute('data-content-padding')).toBe('template');

    fireEvent.click(probe);
    expect(updatePage).toHaveBeenCalledWith('database-view-id', { name: 'Renamed view' });
  });
});

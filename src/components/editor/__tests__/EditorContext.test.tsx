import { render, screen } from '@testing-library/react';

import { EditorContextProvider, useEditorContext } from '../EditorContext';

function RowDocumentContextProbe() {
  const context = useEditorContext();

  return (
    <div
      data-testid="row-document-context"
      data-has-check={String(Boolean(context.checkIfRowDocumentExists))}
      data-has-create={String(Boolean(context.createRowDocument))}
      data-has-load={String(Boolean(context.loadRowDocument))}
    />
  );
}

describe('EditorContextProvider', () => {
  it('preserves row document operations for embedded databases', () => {
    render(
      <EditorContextProvider
        workspaceId="workspace-id"
        viewId="view-id"
        readOnly={false}
        checkIfRowDocumentExists={jest.fn()}
        createRowDocument={jest.fn()}
        loadRowDocument={jest.fn()}
      >
        <RowDocumentContextProbe />
      </EditorContextProvider>
    );

    const probe = screen.getByTestId('row-document-context');

    expect(probe.getAttribute('data-has-check')).toBe('true');
    expect(probe.getAttribute('data-has-create')).toBe('true');
    expect(probe.getAttribute('data-has-load')).toBe('true');
  });
});

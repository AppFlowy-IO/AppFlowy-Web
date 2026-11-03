import { expect } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { ReactNode } from 'react';
import { ErrorBoundary, type FallbackProps } from 'react-error-boundary';

import EditorEditable from '../Editable';

const mockEditor = { children: [] };

jest.mock('slate-react', () => ({
  useSlate: () => mockEditor,
  ReactEditor: { toDOMNode: () => document.createElement('div') },
  Editable: () => {
    throw new Error('Editor render failed');
  },
}));
jest.mock('../EditorContext', () => ({
  useEditorContext: () => ({ readOnly: true, viewId: 'view', workspaceId: 'workspace' }),
  useEditorLocalState: () => ({}),
}));
jest.mock('../shortcut.hooks', () => ({ useShortcuts: () => ({}) }));
jest.mock('../components/blocks/code/useDecorate', () => ({ useDecorate: () => () => [] }));
jest.mock('../components/find-replace/FindReplaceContext', () => ({
  useFindReplaceDecorations: () => ({ getMatchDecorations: () => [] }),
}));
jest.mock('../components/element', () => ({ Element: () => null }));
jest.mock('../components/leaf', () => ({ Leaf: () => null }));
jest.mock('../components/leaf/href/HrefPopover', () => ({ __esModule: true, default: () => null }));
jest.mock('../components/panels/PanelsContext', () => ({
  PanelProvider: ({ children }: { children: ReactNode }) => children,
}));
jest.mock('../components/block-popover/BlockPopoverContext', () => ({
  BlockPopoverProvider: ({ children }: { children: ReactNode }) => children,
}));
jest.mock('../components/remote-selections', () => ({ RemoteSelectionsLayer: () => null }));
jest.mock('@/components/inline-comment/editor/InlineCommentEditorControls', () => ({
  InlineCommentEditorControls: () => null,
}));

// Stands in for the page-level boundary in MainLayout.
function PageError({ error }: FallbackProps) {
  return <div data-testid='page-error'>{String(error)}</div>;
}

describe('Editor render errors', () => {
  afterEach(() => jest.restoreAllMocks());

  it('shows an editor render failure inline instead of failing the page', () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    render(
      <ErrorBoundary FallbackComponent={PageError}>
        <EditorEditable />
      </ErrorBoundary>
    );

    expect(screen.queryByTestId('page-error')).toBeNull();
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});

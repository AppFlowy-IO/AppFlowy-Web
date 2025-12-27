import { Editor, Element as SlateElement, Transforms } from 'slate';

import { DocumentTest, FromBlockJSON } from 'cypress/support/document';

import type { YHistoryEditor } from '@/application/slate-yjs/plugins/withHistory';
import { mountEditor } from '@/components/editor/__tests__/mount';

describe('Database block lifecycle', () => {
  const isGridElement = (node: unknown): boolean => {
    return SlateElement.isElement(node) && (node as SlateElement & { type?: string }).type === 'grid';
  };

  beforeEach(() => {
    cy.viewport(1280, 720);
    Object.defineProperty(window.navigator, 'language', { value: 'en-US' });
  });

  it('does not delete page when a removed database block is restored via undo', () => {
    const baseViewId = 'database-view-1';
    const deletePage = cy.stub().as('deletePage').resolves();

    const documentTest = new DocumentTest();
    const initialData: FromBlockJSON[] = [
      {
        type: 'grid',
        data: { parent_id: 'test', view_id: baseViewId },
        text: [],
        children: [],
      },
      {
        type: 'paragraph',
        data: {},
        text: [{ insert: 'Hello' }],
        children: [],
      },
    ];

    documentTest.fromJSON(initialData);
    mountEditor({
      readOnly: false,
      doc: documentTest.doc,
      viewId: 'test',
      workspaceId: 'test',
      deletePage,
    });

    cy.get('[role="textbox"]').should('exist');

    cy.clock();

    cy.window().then((win) => {
      const testWindow = win as unknown as { __TEST_EDITOR__?: YHistoryEditor };
      const editor = testWindow.__TEST_EDITOR__;

      expect(editor).to.exist;
      if (!editor) throw new Error('Missing __TEST_EDITOR__');

      const gridEntry = Array.from(
        Editor.nodes(editor, {
          at: [],
          match: isGridElement,
        })
      )[0];

      expect(gridEntry, 'grid block exists').to.exist;

      const [, path] = gridEntry;

      Transforms.removeNodes(editor, { at: path });
      editor.undo();
    });

    cy.tick(2000);
    cy.get('@deletePage').should('not.have.been.called');
  });

  it('does not delete page when a database block is removed', () => {
    const baseViewId = 'database-view-1';
    const deletePage = cy.stub().as('deletePage').resolves();

    const documentTest = new DocumentTest();
    const initialData: FromBlockJSON[] = [
      {
        type: 'grid',
        data: { parent_id: 'test', view_id: baseViewId },
        text: [],
        children: [],
      },
      {
        type: 'paragraph',
        data: {},
        text: [{ insert: 'Hello' }],
        children: [],
      },
    ];

    documentTest.fromJSON(initialData);
    mountEditor({
      readOnly: false,
      doc: documentTest.doc,
      viewId: 'test',
      workspaceId: 'test',
      deletePage,
    });

    cy.get('[role="textbox"]').should('exist');

    cy.clock();

    cy.window().then((win) => {
      const testWindow = win as unknown as { __TEST_EDITOR__?: YHistoryEditor };
      const editor = testWindow.__TEST_EDITOR__;

      expect(editor).to.exist;
      if (!editor) throw new Error('Missing __TEST_EDITOR__');

      const gridEntry = Array.from(
        Editor.nodes(editor, {
          at: [],
          match: isGridElement,
        })
      )[0];

      expect(gridEntry, 'grid block exists').to.exist;

      const [, path] = gridEntry;

      Transforms.removeNodes(editor, { at: path });
    });

    cy.tick(2000);
    cy.get('@deletePage').should('not.have.been.called');
  });
});

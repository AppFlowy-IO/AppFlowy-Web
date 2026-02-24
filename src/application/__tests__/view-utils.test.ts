import { expect } from '@jest/globals';
import { View, ViewLayout } from '../types';
import {
  isDatabaseLayout,
  isDatabaseContainer,
  isEmbeddedView,
  getDatabaseIdFromExtra,
  isReferencedDatabaseView,
  getFirstChildView,
  getDatabaseTabViewIds,
  isLinkedDatabaseViewUnderDocument,
  canBeMoved,
} from '../view-utils';

/**
 * Tests for view-utils.ts - Database Container Support
 *
 * These tests verify the utility functions that implement database container logic
 * matching the Desktop/Flutter implementation.
 *
 * Reference: AppFlowy-Premium/frontend/doc/context/database_container_behavior.md
 */

// Helper function to create a mock View object
function createMockView(overrides: Partial<View> = {}): View {
  return {
    view_id: 'test-view-id',
    name: 'Test View',
    icon: null,
    layout: ViewLayout.Document,
    extra: null,
    children: [],
    is_private: false,
    ...overrides,
  };
}

describe('view-utils', () => {
  describe('isDatabaseLayout', () => {
    it('should return true for Grid layout', () => {
      expect(isDatabaseLayout(ViewLayout.Grid)).toBe(true);
    });

    it('should return true for Board layout', () => {
      expect(isDatabaseLayout(ViewLayout.Board)).toBe(true);
    });

    it('should return true for Calendar layout', () => {
      expect(isDatabaseLayout(ViewLayout.Calendar)).toBe(true);
    });

    it('should return false for Document layout', () => {
      expect(isDatabaseLayout(ViewLayout.Document)).toBe(false);
    });

    it('should return false for AIChat layout', () => {
      expect(isDatabaseLayout(ViewLayout.AIChat)).toBe(false);
    });
  });

  describe('isDatabaseContainer', () => {
    it('should return true when is_database_container is true', () => {
      const view = createMockView({
        extra: { is_space: false, is_database_container: true },
      });
      expect(isDatabaseContainer(view)).toBe(true);
    });

    it('should return false when is_database_container is false', () => {
      const view = createMockView({
        extra: { is_space: false, is_database_container: false },
      });
      expect(isDatabaseContainer(view)).toBe(false);
    });

    it('should return false when is_database_container is not set', () => {
      const view = createMockView({
        extra: { is_space: false },
      });
      expect(isDatabaseContainer(view)).toBe(false);
    });

    it('should return false when extra is null', () => {
      const view = createMockView({ extra: null });
      expect(isDatabaseContainer(view)).toBe(false);
    });

    it('should return false for null view', () => {
      expect(isDatabaseContainer(null)).toBe(false);
    });

    it('should return false for undefined view', () => {
      expect(isDatabaseContainer(undefined)).toBe(false);
    });
  });

  describe('getDatabaseIdFromExtra', () => {
    it('should return database_id when set', () => {
      const view = createMockView({
        extra: { is_space: false, database_id: 'db-123' },
      });
      expect(getDatabaseIdFromExtra(view)).toBe('db-123');
    });

    it('should return undefined when database_id is not set', () => {
      const view = createMockView({
        extra: { is_space: false },
      });
      expect(getDatabaseIdFromExtra(view)).toBeUndefined();
    });

    it('should return undefined when extra is null', () => {
      const view = createMockView({ extra: null });
      expect(getDatabaseIdFromExtra(view)).toBeUndefined();
    });

    it('should return undefined for null view', () => {
      expect(getDatabaseIdFromExtra(null)).toBeUndefined();
    });

    it('should return undefined for undefined view', () => {
      expect(getDatabaseIdFromExtra(undefined)).toBeUndefined();
    });
  });

  describe('isReferencedDatabaseView', () => {
    /**
     * Scenario: Referenced database views show a dot icon instead of expand/collapse.
     * This happens when a database view is a child of another database view
     * (including database containers, whose layout is also a database layout).
     */

    it('should return true when database view is child of another database view', () => {
      // Grid view under another Grid view (linked database)
      const childView = createMockView({
        view_id: 'child-grid',
        layout: ViewLayout.Grid,
      });
      const parentView = createMockView({
        view_id: 'parent-grid',
        layout: ViewLayout.Grid,
      });
      expect(isReferencedDatabaseView(childView, parentView)).toBe(true);
    });

    it('should return true for Board under Grid', () => {
      const childView = createMockView({
        view_id: 'child-board',
        layout: ViewLayout.Board,
      });
      const parentView = createMockView({
        view_id: 'parent-grid',
        layout: ViewLayout.Grid,
      });
      expect(isReferencedDatabaseView(childView, parentView)).toBe(true);
    });

    it('should return true for Calendar under Board', () => {
      const childView = createMockView({
        view_id: 'child-calendar',
        layout: ViewLayout.Calendar,
      });
      const parentView = createMockView({
        view_id: 'parent-board',
        layout: ViewLayout.Board,
      });
      expect(isReferencedDatabaseView(childView, parentView)).toBe(true);
    });

    it('should return true when parent is a database container', () => {
      const childView = createMockView({
        view_id: 'child-grid',
        layout: ViewLayout.Grid,
      });
      const containerView = createMockView({
        view_id: 'container',
        layout: ViewLayout.Grid, // Container might have any layout
        extra: { is_space: false, is_database_container: true },
      });
      expect(isReferencedDatabaseView(childView, containerView)).toBe(true);
    });

    it('should return false when database view is under Document', () => {
      const childView = createMockView({
        view_id: 'child-grid',
        layout: ViewLayout.Grid,
      });
      const parentView = createMockView({
        view_id: 'parent-doc',
        layout: ViewLayout.Document,
      });
      expect(isReferencedDatabaseView(childView, parentView)).toBe(false);
    });

    it('should return false when Document view is under database view', () => {
      const childView = createMockView({
        view_id: 'child-doc',
        layout: ViewLayout.Document,
      });
      const parentView = createMockView({
        view_id: 'parent-grid',
        layout: ViewLayout.Grid,
      });
      expect(isReferencedDatabaseView(childView, parentView)).toBe(false);
    });

    it('should return false when parent is null', () => {
      const childView = createMockView({
        view_id: 'child-grid',
        layout: ViewLayout.Grid,
      });
      expect(isReferencedDatabaseView(childView, null)).toBe(false);
    });

    it('should return false when view is null', () => {
      const parentView = createMockView({
        view_id: 'parent-grid',
        layout: ViewLayout.Grid,
      });
      expect(isReferencedDatabaseView(null, parentView)).toBe(false);
    });

    it('should return false when both are null', () => {
      expect(isReferencedDatabaseView(null, null)).toBe(false);
    });

    it('should return false when both are undefined', () => {
      expect(isReferencedDatabaseView(undefined, undefined)).toBe(false);
    });
  });

  describe('getFirstChildView', () => {
    /**
     * Scenario 1: Clicking on a database container should auto-open first child.
     */

    it('should return first child of database container', () => {
      const childView = createMockView({
        view_id: 'first-child-grid',
        layout: ViewLayout.Grid,
      });
      const secondChild = createMockView({
        view_id: 'second-child-board',
        layout: ViewLayout.Board,
      });
      const containerView = createMockView({
        view_id: 'container',
        extra: { is_space: false, is_database_container: true },
        children: [childView, secondChild],
      });

      const result = getFirstChildView(containerView);
      expect(result).toBeDefined();
      expect(result?.view_id).toBe('first-child-grid');
    });

    it('should return undefined for container with no children', () => {
      const containerView = createMockView({
        view_id: 'container',
        extra: { is_space: false, is_database_container: true },
        children: [],
      });

      expect(getFirstChildView(containerView)).toBeUndefined();
    });

    it('should return undefined for non-container view with children', () => {
      const childView = createMockView({
        view_id: 'child-doc',
        layout: ViewLayout.Document,
      });
      const regularView = createMockView({
        view_id: 'regular-doc',
        layout: ViewLayout.Document,
        children: [childView],
      });

      expect(getFirstChildView(regularView)).toBeUndefined();
    });

    it('should return undefined for null view', () => {
      expect(getFirstChildView(null)).toBeUndefined();
    });

    it('should return undefined for undefined view', () => {
      expect(getFirstChildView(undefined)).toBeUndefined();
    });
  });

  /**
   * Integration tests that verify complete container scenarios
   */
  describe('Database Container Scenarios', () => {
    /**
     * Scenario 1: Standalone database from sidebar
     *
     * Structure:
     * Sidebar
     * └── Database Container (is_database_container: true, database_id: xxx)
     *     └── Grid View (database_id: xxx)
     */
    describe('Scenario 1: Standalone database from sidebar', () => {
      const gridView = createMockView({
        view_id: 'grid-view-id',
        name: 'Grid View',
        layout: ViewLayout.Grid,
        extra: { is_space: false, database_id: 'db-123' },
      });

      const containerView = createMockView({
        view_id: 'container-id',
        name: 'My Database',
        layout: ViewLayout.Grid,
        extra: {
          is_space: false,
          is_database_container: true,
          database_id: 'db-123',
        },
        children: [gridView],
      });

      it('container should be identified as database container', () => {
        expect(isDatabaseContainer(containerView)).toBe(true);
      });

      it('container should have database_id in extra', () => {
        expect(getDatabaseIdFromExtra(containerView)).toBe('db-123');
      });

      it('clicking container should navigate to first child', () => {
        const firstChild = getFirstChildView(containerView);
        expect(firstChild).toBeDefined();
        expect(firstChild?.view_id).toBe('grid-view-id');
      });

      it('child view should be referenced database view (dot icon)', () => {
        expect(isReferencedDatabaseView(gridView, containerView)).toBe(true);
      });
    });

    /**
     * Scenario 2: New database in document (embedded)
     *
     * Structure:
     * Document
     * └── [Database Block referencing view_id]
     *         ↓
     * Sidebar/child of document
     * └── Database Container (is_database_container: true)
     *     └── Grid View (database_id: xxx)
     */
    describe('Scenario 2: New database in document', () => {
      const embeddedGridView = createMockView({
        view_id: 'embedded-grid-id',
        name: 'Embedded Grid',
        layout: ViewLayout.Grid,
        extra: { is_space: false, database_id: 'db-456' },
      });

      const containerForEmbedded = createMockView({
        view_id: 'container-for-embedded',
        name: 'Embedded Database',
        layout: ViewLayout.Grid,
        extra: {
          is_space: false,
          is_database_container: true,
          database_id: 'db-456',
        },
        children: [embeddedGridView],
      });

      it('container for embedded should be identified correctly', () => {
        expect(isDatabaseContainer(containerForEmbedded)).toBe(true);
      });

      it('embedded grid view should have database_id', () => {
        expect(getDatabaseIdFromExtra(embeddedGridView)).toBe('db-456');
      });

      it('getFirstChildView returns the embedded view', () => {
        const firstChild = getFirstChildView(containerForEmbedded);
        expect(firstChild?.view_id).toBe('embedded-grid-id');
      });
    });

    /**
     * Scenario 3: Link existing database in document
     *
     * NO container created - linked view is child of document directly.
     */
    describe('Scenario 3: Link existing database in document', () => {
      const linkedView = createMockView({
        view_id: 'linked-view-id',
        name: 'Linked Grid',
        layout: ViewLayout.Grid,
        extra: { is_space: false, database_id: 'existing-db-789' },
      });

      const documentView = createMockView({
        view_id: 'doc-id',
        name: 'My Document',
        layout: ViewLayout.Document,
        children: [linkedView],
      });

      it('document is NOT a database container', () => {
        expect(isDatabaseContainer(documentView)).toBe(false);
      });

      it('linked view has database_id pointing to existing database', () => {
        expect(getDatabaseIdFromExtra(linkedView)).toBe('existing-db-789');
      });

      it('linked view under document is NOT a referenced database view', () => {
        // Because parent is Document, not a database layout
        expect(isReferencedDatabaseView(linkedView, documentView)).toBe(false);
      });
    });

    /**
     * Scenario 4: Add view via tab bar
     *
     * New view added to existing container - NO new container created.
     *
     * Structure:
     * Sidebar
     * └── Database Container
     *     ├── Grid View (original)
     *     └── Board View (new linked view)
     */
    describe('Scenario 4: Add view via tab bar', () => {
      const originalGridView = createMockView({
        view_id: 'original-grid',
        name: 'Original Grid',
        layout: ViewLayout.Grid,
        extra: { is_space: false, database_id: 'db-tab-bar' },
      });

      const newBoardView = createMockView({
        view_id: 'new-board',
        name: 'New Board',
        layout: ViewLayout.Board,
        extra: { is_space: false, database_id: 'db-tab-bar' },
      });

      const containerWithMultipleViews = createMockView({
        view_id: 'container-with-tabs',
        name: 'Database with Tabs',
        layout: ViewLayout.Grid,
        extra: {
          is_space: false,
          is_database_container: true,
          database_id: 'db-tab-bar',
        },
        children: [originalGridView, newBoardView],
      });

      it('container holds multiple child views', () => {
        expect(containerWithMultipleViews.children.length).toBe(2);
      });

      it('all children share the same database_id', () => {
        expect(getDatabaseIdFromExtra(originalGridView)).toBe('db-tab-bar');
        expect(getDatabaseIdFromExtra(newBoardView)).toBe('db-tab-bar');
      });

      it('getFirstChildView returns the first view (Grid)', () => {
        const firstChild = getFirstChildView(containerWithMultipleViews);
        expect(firstChild?.view_id).toBe('original-grid');
        expect(firstChild?.layout).toBe(ViewLayout.Grid);
      });

      it('child views are referenced database views', () => {
        expect(isReferencedDatabaseView(originalGridView, containerWithMultipleViews)).toBe(true);
        expect(isReferencedDatabaseView(newBoardView, containerWithMultipleViews)).toBe(true);
      });
    });

    describe('getDatabaseTabViewIds', () => {
      it('filters embedded views from container tabs', () => {
        const gridView = createMockView({
          view_id: 'grid-view',
          layout: ViewLayout.Grid,
          extra: { is_space: false, database_id: 'db-1' },
        });
        const embeddedBoardView = createMockView({
          view_id: 'board-view',
          layout: ViewLayout.Board,
          extra: { is_space: false, database_id: 'db-1', embedded: true },
        });
        const container = createMockView({
          view_id: 'container',
          layout: ViewLayout.Grid,
          extra: {
            is_space: false,
            is_database_container: true,
            database_id: 'db-1',
          },
          children: [gridView, embeddedBoardView],
        });

        expect(isEmbeddedView(gridView)).toBe(false);
        expect(isEmbeddedView(embeddedBoardView)).toBe(true);
        expect(getDatabaseTabViewIds(gridView.view_id, container)).toEqual([gridView.view_id]);
      });

      it('shows only the embedded view when opening it from the sidebar', () => {
        const gridView = createMockView({
          view_id: 'grid-view',
          layout: ViewLayout.Grid,
          extra: { is_space: false, database_id: 'db-1' },
        });
        const embeddedBoardView = createMockView({
          view_id: 'board-view',
          layout: ViewLayout.Board,
          extra: { is_space: false, database_id: 'db-1', embedded: true },
        });
        const container = createMockView({
          view_id: 'container',
          layout: ViewLayout.Grid,
          extra: {
            is_space: false,
            is_database_container: true,
            database_id: 'db-1',
          },
          children: [gridView, embeddedBoardView],
        });

        expect(getDatabaseTabViewIds(embeddedBoardView.view_id, container)).toEqual([
          embeddedBoardView.view_id,
        ]);
      });

      it('falls back to display tabs when opening a container directly', () => {
        const gridView = createMockView({
          view_id: 'grid-view',
          layout: ViewLayout.Grid,
          extra: { is_space: false, database_id: 'db-1' },
        });
        const embeddedBoardView = createMockView({
          view_id: 'board-view',
          layout: ViewLayout.Board,
          extra: { is_space: false, database_id: 'db-1', embedded: true },
        });
        const container = createMockView({
          view_id: 'container',
          layout: ViewLayout.Grid,
          extra: {
            is_space: false,
            is_database_container: true,
            database_id: 'db-1',
          },
          children: [gridView, embeddedBoardView],
        });

        expect(getDatabaseTabViewIds(container.view_id, container)).toEqual([gridView.view_id]);
      });

      it('keeps all tabs when a database only has embedded views', () => {
        const embeddedGridView = createMockView({
          view_id: 'embedded-grid',
          layout: ViewLayout.Grid,
          extra: { is_space: false, database_id: 'db-1', embedded: true },
        });
        const embeddedBoardView = createMockView({
          view_id: 'embedded-board',
          layout: ViewLayout.Board,
          extra: { is_space: false, database_id: 'db-1', embedded: true },
        });
        const container = createMockView({
          view_id: 'container',
          layout: ViewLayout.Grid,
          extra: {
            is_space: false,
            is_database_container: true,
            database_id: 'db-1',
            embedded: true,
          },
          children: [embeddedGridView, embeddedBoardView],
        });

        expect(getDatabaseTabViewIds(embeddedGridView.view_id, container)).toEqual([
          embeddedGridView.view_id,
          embeddedBoardView.view_id,
        ]);
      });
    });

    /**
     * Backward Compatibility: Views without container support
     *
     * Older databases without is_database_container should still work.
     */
    describe('Backward Compatibility', () => {
      const legacyGridView = createMockView({
        view_id: 'legacy-grid',
        name: 'Legacy Grid',
        layout: ViewLayout.Grid,
        extra: { is_space: false },
      });

      it('legacy view without is_database_container is not a container', () => {
        expect(isDatabaseContainer(legacyGridView)).toBe(false);
      });

      it('legacy view without database_id returns undefined', () => {
        expect(getDatabaseIdFromExtra(legacyGridView)).toBeUndefined();
      });

      it('getFirstChildView returns undefined for non-container', () => {
        expect(getFirstChildView(legacyGridView)).toBeUndefined();
      });
    });
  });

  /**
   * Tests for isLinkedDatabaseViewUnderDocument
   *
   * Linked database views under documents are database views that:
   * - Have a database layout (Grid, Board, Calendar)
   * - Are NOT database containers
   * - Have a Document parent
   */
  describe('isLinkedDatabaseViewUnderDocument', () => {
    it('returns true for non-container database view under document', () => {
      const view = createMockView({
        view_id: 'grid-view',
        layout: ViewLayout.Grid,
        extra: { is_space: false },
      });
      const parentView = createMockView({
        view_id: 'parent-doc',
        layout: ViewLayout.Document,
      });

      expect(isLinkedDatabaseViewUnderDocument(view, parentView)).toBe(true);
    });

    it('returns false for database container under document', () => {
      const view = createMockView({
        view_id: 'container-view',
        layout: ViewLayout.Grid,
        extra: { is_space: false, is_database_container: true },
      });
      const parentView = createMockView({
        view_id: 'parent-doc',
        layout: ViewLayout.Document,
      });

      expect(isLinkedDatabaseViewUnderDocument(view, parentView)).toBe(false);
    });

    it('returns false for database view under non-document parent', () => {
      const view = createMockView({
        view_id: 'grid-view',
        layout: ViewLayout.Grid,
        extra: { is_space: false },
      });
      const parentView = createMockView({
        view_id: 'parent-grid',
        layout: ViewLayout.Board,
      });

      expect(isLinkedDatabaseViewUnderDocument(view, parentView)).toBe(false);
    });

    it('returns false for document view under document', () => {
      const view = createMockView({
        view_id: 'child-doc',
        layout: ViewLayout.Document,
      });
      const parentView = createMockView({
        view_id: 'parent-doc',
        layout: ViewLayout.Document,
      });

      expect(isLinkedDatabaseViewUnderDocument(view, parentView)).toBe(false);
    });

    it('returns false when parent is null', () => {
      const view = createMockView({
        view_id: 'grid-view',
        layout: ViewLayout.Grid,
      });

      expect(isLinkedDatabaseViewUnderDocument(view, null)).toBe(false);
    });

    it('returns false when view is null', () => {
      const parentView = createMockView({
        view_id: 'parent-doc',
        layout: ViewLayout.Document,
      });

      expect(isLinkedDatabaseViewUnderDocument(null, parentView)).toBe(false);
    });

    it('returns true for all database layouts under document (non-container)', () => {
      const databaseLayouts = [ViewLayout.Grid, ViewLayout.Board, ViewLayout.Calendar];
      const parentView = createMockView({
        view_id: 'parent-doc',
        layout: ViewLayout.Document,
      });

      for (const layout of databaseLayouts) {
        const view = createMockView({
          view_id: 'db-view',
          layout,
          extra: { is_space: false },
        });

        expect(isLinkedDatabaseViewUnderDocument(view, parentView)).toBe(true);
      }
    });

    // Web workaround tests: embedded views with is_database_container=true but no children
    describe('Web workaround for incorrect is_database_container flag', () => {
      it('returns true for embedded database view with is_database_container=true but no children', () => {
        const view = createMockView({
          view_id: 'embedded-grid',
          layout: ViewLayout.Grid,
          extra: { is_space: false, is_database_container: true, embedded: true },
          children: [], // No children indicates it's a linked view
        });
        const parentView = createMockView({
          view_id: 'parent-doc',
          layout: ViewLayout.Document,
        });

        expect(isLinkedDatabaseViewUnderDocument(view, parentView)).toBe(true);
      });

      it('returns false for embedded database container with has_children=true but empty children (lazy loading)', () => {
        const view = createMockView({
          view_id: 'lazy-container',
          layout: ViewLayout.Grid,
          extra: { is_space: false, is_database_container: true, embedded: true },
          children: [], // Children not loaded yet (lazy loading)
          has_children: true, // Server indicates children exist
        });
        const parentView = createMockView({
          view_id: 'parent-doc',
          layout: ViewLayout.Document,
        });

        expect(isLinkedDatabaseViewUnderDocument(view, parentView)).toBe(false);
      });

      it('returns false for embedded database view with is_database_container=true AND children', () => {
        const childView = createMockView({
          view_id: 'child-view',
          layout: ViewLayout.Grid,
        });
        const view = createMockView({
          view_id: 'container-grid',
          layout: ViewLayout.Grid,
          extra: { is_space: false, is_database_container: true, embedded: true },
          children: [childView], // Has children, so it's a true container
        });
        const parentView = createMockView({
          view_id: 'parent-doc',
          layout: ViewLayout.Document,
        });

        expect(isLinkedDatabaseViewUnderDocument(view, parentView)).toBe(false);
      });
    });
  });

  /**
   * Tests for canBeMoved
   *
   * Mirrors Desktop/Flutter implementation in view_ext.dart canBeDragged().
   * Views should NOT be movable in these cases:
   * - Case 1: Referenced database views (database inside database)
   * - Case 2: Children of database containers
   * - Case 3: Linked database views under documents
   */
  describe('canBeMoved', () => {
    describe('returns true for movable views', () => {
      it('Document under Document', () => {
        const view = createMockView({
          view_id: 'child-doc',
          layout: ViewLayout.Document,
        });
        const parentView = createMockView({
          view_id: 'parent-doc',
          layout: ViewLayout.Document,
        });

        expect(canBeMoved(view, parentView)).toBe(true);
      });

      it('Database container under Document', () => {
        const view = createMockView({
          view_id: 'container-view',
          layout: ViewLayout.Grid,
          extra: { is_space: false, is_database_container: true },
        });
        const parentView = createMockView({
          view_id: 'parent-doc',
          layout: ViewLayout.Document,
        });

        expect(canBeMoved(view, parentView)).toBe(true);
      });

      it('View with null parent', () => {
        const view = createMockView({
          view_id: 'root-view',
          layout: ViewLayout.Document,
        });

        expect(canBeMoved(view, null)).toBe(true);
      });

      it('Chat view under Document', () => {
        const view = createMockView({
          view_id: 'chat-view',
          layout: ViewLayout.AIChat,
        });
        const parentView = createMockView({
          view_id: 'parent-doc',
          layout: ViewLayout.Document,
        });

        expect(canBeMoved(view, parentView)).toBe(true);
      });
    });

    describe('Case 1: Referenced database views cannot be moved', () => {
      it('Grid view under Board view', () => {
        const view = createMockView({
          view_id: 'grid-view',
          layout: ViewLayout.Grid,
        });
        const parentView = createMockView({
          view_id: 'parent-board',
          layout: ViewLayout.Board,
        });

        expect(canBeMoved(view, parentView)).toBe(false);
      });

      it('Calendar view under Grid view', () => {
        const view = createMockView({
          view_id: 'calendar-view',
          layout: ViewLayout.Calendar,
        });
        const parentView = createMockView({
          view_id: 'parent-grid',
          layout: ViewLayout.Grid,
        });

        expect(canBeMoved(view, parentView)).toBe(false);
      });
    });

    describe('Case 2: Children of database containers cannot be moved', () => {
      it('Grid view under database container', () => {
        const view = createMockView({
          view_id: 'grid-view',
          layout: ViewLayout.Grid,
        });
        const containerView = createMockView({
          view_id: 'container',
          layout: ViewLayout.Document,
          extra: { is_space: false, is_database_container: true },
        });

        expect(canBeMoved(view, containerView)).toBe(false);
      });

      it('Board view under database container', () => {
        const view = createMockView({
          view_id: 'board-view',
          layout: ViewLayout.Board,
        });
        const containerView = createMockView({
          view_id: 'container',
          layout: ViewLayout.Grid,
          extra: { is_space: false, is_database_container: true },
        });

        expect(canBeMoved(view, containerView)).toBe(false);
      });
    });

    describe('Case 3: Linked database views under documents cannot be moved', () => {
      it('Non-container Grid view under Document', () => {
        const view = createMockView({
          view_id: 'linked-grid',
          layout: ViewLayout.Grid,
          extra: { is_space: false },
        });
        const parentView = createMockView({
          view_id: 'parent-doc',
          layout: ViewLayout.Document,
        });

        expect(canBeMoved(view, parentView)).toBe(false);
      });

      it('Non-container Board view under Document', () => {
        const view = createMockView({
          view_id: 'linked-board',
          layout: ViewLayout.Board,
          extra: { is_space: false },
        });
        const parentView = createMockView({
          view_id: 'parent-doc',
          layout: ViewLayout.Document,
        });

        expect(canBeMoved(view, parentView)).toBe(false);
      });

      it('Non-container Calendar view under Document', () => {
        const view = createMockView({
          view_id: 'linked-calendar',
          layout: ViewLayout.Calendar,
          extra: { is_space: false },
        });
        const parentView = createMockView({
          view_id: 'parent-doc',
          layout: ViewLayout.Document,
        });

        expect(canBeMoved(view, parentView)).toBe(false);
      });

      // Web workaround: embedded views with is_database_container=true but no children
      // should also be blocked from moving
      it('Embedded database view with is_database_container=true but no children under Document (web workaround)', () => {
        const view = createMockView({
          view_id: 'embedded-grid',
          layout: ViewLayout.Grid,
          extra: { is_space: false, is_database_container: true, embedded: true },
          children: [], // No children indicates it's a linked view, not a true container
        });
        const parentView = createMockView({
          view_id: 'parent-doc',
          layout: ViewLayout.Document,
        });

        expect(canBeMoved(view, parentView)).toBe(false);
      });

      it('Database container WITH children under Document CAN be moved', () => {
        const childView = createMockView({
          view_id: 'child-view',
          layout: ViewLayout.Grid,
        });
        const view = createMockView({
          view_id: 'container-grid',
          layout: ViewLayout.Grid,
          extra: { is_space: false, is_database_container: true, embedded: true },
          children: [childView], // Has children, so it's a true container
        });
        const parentView = createMockView({
          view_id: 'parent-doc',
          layout: ViewLayout.Document,
        });

        expect(canBeMoved(view, parentView)).toBe(true);
      });
    });

    describe('Edge cases', () => {
      it('handles view with empty extra field', () => {
        const view = createMockView({
          view_id: 'view1',
          layout: ViewLayout.Document,
          extra: null,
        });
        const parentView = createMockView({
          view_id: 'parent1',
          layout: ViewLayout.Document,
        });

        expect(canBeMoved(view, parentView)).toBe(true);
      });

      it('handles parent with empty extra field', () => {
        const view = createMockView({
          view_id: 'view1',
          layout: ViewLayout.Document,
        });
        const parentView = createMockView({
          view_id: 'parent1',
          layout: ViewLayout.Document,
          extra: null,
        });

        expect(canBeMoved(view, parentView)).toBe(true);
      });

      it('returns true when both view and parent are null', () => {
        expect(canBeMoved(null, null)).toBe(true);
      });

      it('returns true when view is null but parent exists', () => {
        const parentView = createMockView({
          view_id: 'parent1',
          layout: ViewLayout.Document,
        });

        expect(canBeMoved(null, parentView)).toBe(true);
      });
    });
  });
});

/**
 * Hooks for determining which database views should be visible.
 *
 * Different contexts require different logic:
 *
 * 1. **Database Container** (`useContainerVisibleViewIds`)
 *    - Used by `DatabaseView.tsx` for app-level database pages
 *    - Returns container's children IDs, or undefined for standalone databases
 *
 * 2. **Embedded Database** (`useEmbeddedVisibleViewIds`)
 *    - Used by `DatabaseBlock.tsx` for databases in documents
 *    - Returns view IDs from block data (`view_ids` attribute)
 *
 * The selector (`useDatabaseViewsSelector`) then filters appropriately:
 * - With `visibleViewIds`: shows ONLY those views
 * - Without `visibleViewIds`: shows all non-embedded views
 */
export { useContainerVisibleViewIds } from './useContainerVisibleViewIds';
export { useEmbeddedVisibleViewIds } from './useEmbeddedVisibleViewIds';

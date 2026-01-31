/**
 * Database dispatch hooks - separated by concern (like BLoC pattern)
 *
 * Each file handles a specific category of mutations:
 * - field: Field/property CRUD operations (~13 hooks)
 * - row: Row CRUD operations (~7 hooks) [EXTRACTED]
 * - cell: Cell update operations (~2 hooks) [EXTRACTED]
 * - group: Board group operations (~6 hooks) [EXTRACTED]
 * - view: Database view operations (~6 hooks)
 * - sort-filter: Sort and filter operations (~8 hooks) [EXTRACTED]
 * - type-option: Field type option updates (~11 hooks)
 * - calculation: Field calculation operations (~3 hooks) [EXTRACTED]
 * - utils: Shared utilities for dispatch operations
 *
 * STATUS:
 * - row.ts: Fully extracted (7 hooks)
 * - cell.ts: Fully extracted (2 hooks)
 * - group.ts: Fully extracted (6 hooks)
 * - sort-filter.ts: Fully extracted (8 hooks)
 * - calculation.ts: Fully extracted (3 hooks)
 * - utils.ts: Shared utilities
 * - field.ts: Re-export from ../dispatch.ts
 * - view.ts: Re-export from ../dispatch.ts
 * - type-option.ts: Re-export from ../dispatch.ts
 */

export * from './field';
export * from './row';
export * from './cell';
export * from './group';
export * from './view';
export * from './sort-filter';
export * from './type-option';
export * from './calculation';
export { executeOperationWithAllViews } from './utils';

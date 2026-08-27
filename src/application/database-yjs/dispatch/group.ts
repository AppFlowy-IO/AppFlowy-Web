/**
 * Group dispatch hooks.
 *
 * Keep this compatibility entry point as a pure re-export. The canonical
 * implementations live in ../dispatch so imports through `dispatch`,
 * `dispatch/index`, and `dispatch/group` cannot drift between Grid and Board
 * behavior.
 */
export {
  useDeleteGroupColumnDispatch,
  useGroupByFieldDispatch,
  useReorderGroupColumnDispatch,
  useToggleCollapsedHiddenGroupColumnDispatch,
  useToggleHiddenGroupColumnDispatch,
  useToggleHideUnGrouped,
} from '../dispatch';

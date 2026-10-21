import { getServerInfoSnapshot, ServerInfoState } from '@/utils/server-info';

/** A new Web release must not write filters that allowed legacy clients cannot evaluate. */
export function canWriteRelativeDateComparisons(state: ServerInfoState = getServerInfoSnapshot()): boolean {
  return state.status === 'available' && state.info.enable_relative_date_comparisons === true;
}

import { ViewLayout } from '@/application/types';
import { isDatabaseLayout } from '@/application/view-utils';

export function shouldUseFixedGlobalCommentInput(viewLayout?: ViewLayout | null) {
  if (viewLayout === undefined || viewLayout === null) return true;

  return !isDatabaseLayout(viewLayout);
}

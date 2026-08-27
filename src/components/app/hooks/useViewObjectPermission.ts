import { useContext } from 'react';

import type { CollabObjectPermission } from '@/application/types';
import { AppNavigationContext } from '@/components/app/contexts/AppNavigationContext';

export type ViewObjectCapabilities = Pick<
  CollabObjectPermission,
  'can_read' | 'can_write' | 'can_comment' | 'can_share'
>;

/** Match Desktop's safe initial state while cached content is still visible. */
export const INITIAL_VIEW_OBJECT_CAPABILITIES: Readonly<ViewObjectCapabilities> = Object.freeze({
  can_read: true,
  can_write: false,
  can_comment: false,
  can_share: false,
});

/**
 * Return the canonical server permission for an active route or page modal.
 *
 * The permission is intentionally optional while the background probe is in
 * flight, and outside AppBusinessLayer (for isolated embeds and unit tests).
 */
export function useViewObjectPermission(viewId?: string) {
  const navigation = useContext(AppNavigationContext);

  return viewId ? navigation?.objectPermissions?.[viewId] : undefined;
}

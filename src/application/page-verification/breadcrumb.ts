import { View } from '@/application/types';
import { isDatabaseContainer, isDatabaseLayout } from '@/application/view-utils';

/** A database tab belongs to the container whose title and verification the header shows. */
export function getBreadcrumbVerificationTarget(crumbs: View[] = []): View | undefined {
  const current = crumbs[crumbs.length - 1];
  const parent = crumbs[crumbs.length - 2];

  if (current && isDatabaseLayout(current.layout) && isDatabaseContainer(parent)) {
    return parent;
  }

  return current;
}

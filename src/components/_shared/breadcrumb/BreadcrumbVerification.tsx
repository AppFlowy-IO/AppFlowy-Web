import { getBreadcrumbVerificationTarget } from '@/application/page-verification/breadcrumb';
import { UIVariant, View } from '@/application/types';
import { isSpaceView } from '@/application/view-utils';
import { PageVerificationControl } from '@/components/page-verification/PageVerificationControl';

/** The bar and overflow menu use the same page identity and ancestor display rules. */
export function BreadcrumbVerification({
  crumbs,
  crumb,
  variant,
  container,
}: {
  crumbs: View[];
  crumb: View;
  variant?: UIVariant;
  container?: HTMLElement | null;
}) {
  if (
    variant !== UIVariant.App ||
    isSpaceView(crumb) ||
    crumb.view_id !== getBreadcrumbVerificationTarget(crumbs.slice(0, crumbs.indexOf(crumb) + 1))?.view_id
  )
    return null;

  return (
    <PageVerificationControl
      targetId={crumb.view_id}
      displayMode='status'
      badgeOnly={crumb.view_id !== crumbs[crumbs.length - 1]?.view_id}
      readOnly={crumb.is_locked}
      container={container}
    />
  );
}

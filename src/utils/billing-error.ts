import { ERROR_CODE } from '@/application/constants';
import { readErrorIdentity, supportedPublicError } from '@/application/errors/error-message';
import { getWorkspacePlanPolicy } from '@/application/workspace-plan-policy';

// Only include errors whose remedy is a Pro workspace. AI Max, paid-plan
// quotas, payload limits and app-version upgrades have different remedies.
const PRO_WORKSPACE_ERROR_CODES = new Set<number>([
  ERROR_CODE.INVALID_SUBSCRIPTION_PLAN,
  ERROR_CODE.FILE_STORAGE_LIMIT_EXCEEDED,
  ERROR_CODE.SINGLE_UPLOAD_LIMIT_EXCEEDED,
  ERROR_CODE.CUSTOM_NAMESPACE_DISABLED,
  ERROR_CODE.FREE_PLAN_GUEST_LIMIT_EXCEEDED,
]);

/** A rejected limit cannot be resolved by retrying, including on self-hosted servers. */
export function isWorkspaceLimitError(error: unknown): boolean {
  const identity = readErrorIdentity(error);

  return identity.sourceDomain === 'appflowy.server' && identity.code !== undefined && PRO_WORKSPACE_ERROR_CODES.has(identity.code);
}

/** Add actionable upgrade guidance without replacing more specific server guidance. */
export function getBillingErrorMessage(error: unknown): string | undefined {
  const identity = readErrorIdentity(error);

  // Preserve explicit public guidance. Legacy diagnostics containing "Pro" are
  // not reviewed copy and must not bypass the shared presentation boundary.
  return isWorkspaceLimitError(error) && !supportedPublicError(identity.user_error)
    ? getWorkspacePlanPolicy().getUpgradeMessage(undefined)
    : undefined;
}

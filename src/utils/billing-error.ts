import { ERROR_CODE } from '@/application/constants';
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

function getWorkspaceLimitError(error: unknown): { message?: unknown } | undefined {
  if (typeof error !== 'object' || error === null) return undefined;

  const candidate = error as { code?: unknown; message?: unknown; response?: { data?: unknown } };
  const payload = candidate.response?.data ?? candidate;

  if (typeof payload !== 'object' || payload === null) return undefined;
  const { code, message } = payload as { code?: unknown; message?: unknown };

  if (typeof code !== 'number' || !PRO_WORKSPACE_ERROR_CODES.has(code)) return undefined;

  return { message };
}

/** A rejected limit cannot be resolved by retrying, including on self-hosted servers. */
export function isWorkspaceLimitError(error: unknown): boolean {
  return getWorkspaceLimitError(error) !== undefined;
}

/** Add actionable upgrade guidance without replacing more specific server guidance. */
export function getBillingErrorMessage(error: unknown): string | undefined {
  const payload = getWorkspaceLimitError(error);

  return payload ? getWorkspacePlanPolicy().getUpgradeMessage(payload.message) : undefined;
}

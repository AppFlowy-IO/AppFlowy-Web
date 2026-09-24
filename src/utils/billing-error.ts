import i18next from 'i18next';

import { ERROR_CODE } from '@/application/constants';
import { isOfficialHostedServer } from '@/utils/server-info';

const PRO_WORKSPACE_REQUIRED = 'Upgrade this workspace to Pro to use this feature or increase its limits.';

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
  // These codes can also describe administrator-configured self-hosted limits.
  // Use the same server-info decision as the UI, including localhost.
  if (!isOfficialHostedServer()) return undefined;
  const payload = getWorkspaceLimitError(error);

  if (!payload) return undefined;
  const { message } = payload;

  if (typeof message === 'string' && /\bPro\b/i.test(message)) return message;

  return (
    i18next.t('billingLimits.workspaceProRequired', { defaultValue: PRO_WORKSPACE_REQUIRED }) || PRO_WORKSPACE_REQUIRED
  );
}

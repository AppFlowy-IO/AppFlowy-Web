import { getConfigValue } from '@/utils/runtime-config';

/**
 * Presentation entries call AppFlowy Cloud's presentation API. Keep them off unless the deployment
 * enables them, so a Web build served against a Cloud without that API never shows broken entries.
 */
export const PRESENTATION_ENABLED = getConfigValue('APPFLOWY_PRESENTATION_ENABLED', 'false') === 'true';

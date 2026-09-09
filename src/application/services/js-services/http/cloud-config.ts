import type { AFCloudConfig } from '@/application/services/services.type';
import { getConfigValue } from '@/utils/runtime-config';

/**
 * Runtime cloud endpoints shared by the authenticated app and lightweight
 * anonymous routes. Keeping this in a dependency-free module prevents public
 * pages from pulling the authenticated provider graph into their entry chunk.
 */
export const defaultConfig: AFCloudConfig = {
  baseURL: getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud'),
  gotrueURL: getConfigValue('APPFLOWY_GOTRUE_BASE_URL', 'https://test.appflowy.cloud/gotrue'),
  wsURL: '', // Legacy field - not used, keeping for backward compatibility.
};

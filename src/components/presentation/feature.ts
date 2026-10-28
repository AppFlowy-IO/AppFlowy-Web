import { getConfigValue } from '@/utils/runtime-config';

export const PRESENTATION_ENABLED = getConfigValue('APPFLOWY_PRESENTATION_ENABLED', 'true') === 'true';

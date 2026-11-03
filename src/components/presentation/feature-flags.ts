import { useIsOfficialHosted } from '@/components/app/hooks/useServerInfo';

const PRESENTATION_ENTRY_ENABLED = false;

/**
 * Keep the Present button hidden in page and modal headers. When enabled, it remains
 * available only on official AppFlowy Cloud after server info confirms the hosting mode.
 */
export function usePresentationEntryEnabled(): boolean {
  return useIsOfficialHosted() && PRESENTATION_ENTRY_ENABLED;
}

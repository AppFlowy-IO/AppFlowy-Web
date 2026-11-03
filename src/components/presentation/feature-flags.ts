import { useIsOfficialHosted } from '@/components/app/hooks/useServerInfo';

const PRESENTATION_ENTRY_ENABLED = true;

/**
 * Show the Present button in page and modal headers after server info confirms
 * official AppFlowy Cloud hosting.
 */
export function usePresentationEntryEnabled(): boolean {
  return useIsOfficialHosted() && PRESENTATION_ENTRY_ENABLED;
}

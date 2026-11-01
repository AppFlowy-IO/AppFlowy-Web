import { useIsOfficialHosted } from '@/components/app/hooks/useServerInfo';

/**
 * The Present button shows only on official AppFlowy Cloud. Self-hosted servers never see it, and
 * neither does anyone while server info is loading or unavailable, so it cannot flash for them.
 */
export function usePresentationEntryEnabled(): boolean {
  return useIsOfficialHosted();
}

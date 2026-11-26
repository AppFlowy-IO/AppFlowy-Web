import { useServerInfoState } from './useServerInfo';

/** Meetings require an explicit server opt-in as well as server-backed AI. */
export function useMeetingEnabled(): boolean {
  const { info } = useServerInfoState();

  return info?.enable_meeting === true && info.ai_enabled !== false;
}

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

import { WEB_CLIENT_VERSION } from '@/application/compatibility/client-version';
import {
  evaluateCompatibility,
  isCompatibilityWarning,
  updateBannerSession,
  type BannerSession,
  type CompatibilityWarning,
} from '@/application/compatibility/evaluate';
import type { ServerInfo } from '@/application/services/js-services/http/auth-api';

const ClientCompatibilityContext = createContext<{
  warning?: CompatibilityWarning;
  dismiss: () => void;
} | null>(null);

export function ClientCompatibilityProvider({
  serverInfo,
  serverUrl,
  children,
}: {
  serverInfo?: ServerInfo;
  serverUrl: string;
  children: ReactNode;
}) {
  const verdict = useMemo(
    () =>
      evaluateCompatibility({
        clientVersion: WEB_CLIENT_VERSION,
        serverVersion: serverInfo?.version,
        // Native min_client_version belongs to a different release line.
        minClientVersion: serverInfo?.min_web_client_version,
      }),
    [serverInfo?.version, serverInfo?.min_web_client_version]
  );
  const [session, setSession] = useState<BannerSession>({ serverUrl: '', dismissed: false });
  const nextSession = updateBannerSession(session, verdict, serverUrl);

  // Adjust dismissal before rendering children so switching servers never flashes stale UI.
  if (nextSession !== session) setSession(nextSession);

  const dismiss = useCallback(() => setSession((current) => ({ ...current, dismissed: true })), []);
  const warning = !nextSession.dismissed && isCompatibilityWarning(verdict) ? verdict : undefined;
  const value = useMemo(() => ({ warning, dismiss }), [warning, dismiss]);

  return <ClientCompatibilityContext.Provider value={value}>{children}</ClientCompatibilityContext.Provider>;
}

export function useClientCompatibility() {
  return useContext(ClientCompatibilityContext);
}

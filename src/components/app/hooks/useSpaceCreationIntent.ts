import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { SPACE_CREATION_INTENT_CHANGED, SpaceCreationIntentStore } from '@/application/services/js-services/space-creation-intent';
import { getTokenParsed } from '@/application/session/token';
import { getErrorMessage } from '@/utils/errors';
import { getConfigValue } from '@/utils/runtime-config';

export function useSpaceCreationIntent(workspaceId?: string) {
  const userId = getTokenParsed()?.user?.id;
  const serverUrl = getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud');
  const scope = useMemo(() => ({ workspaceId, userId, serverUrl }), [workspaceId, userId, serverUrl]);
  const current = useRef<typeof scope | null>(scope);

  current.current = scope;
  const store = useMemo(() => new SpaceCreationIntentStore(workspaceId ?? '', () => Boolean(workspaceId) && current.current === scope), [workspaceId, scope]);
  const [, render] = useState(0);

  useLayoutEffect(() => {
    current.current = scope;
    return () => { if (current.current === scope) current.current = null; };
  }, [scope]);
  useEffect(() => {
    const changed = () => render((version) => version + 1);

    window.addEventListener(SPACE_CREATION_INTENT_CHANGED, changed);
    return () => window.removeEventListener(SPACE_CREATION_INTENT_CHANGED, changed);
  }, []);

  try { return { store, intent: userId && workspaceId ? store.snapshot() : undefined, error: undefined }; }
  catch (cause) { return { store, intent: undefined, error: getErrorMessage(cause) }; }
}

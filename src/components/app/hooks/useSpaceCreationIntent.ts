import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import {
  InvalidSpaceCreationIntentError,
  SPACE_CREATION_INTENT_CHANGED,
  SpaceCreationIntent,
  SpaceCreationIntentStore,
} from '@/application/services/js-services/space-creation-intent';
import { getTokenParsed } from '@/application/session/token';
import { getConfigValue } from '@/utils/runtime-config';

export type SpaceCreationIntentState = {
  store: SpaceCreationIntentStore;
  intent?: SpaceCreationIntent;
  /** Saved data this build cannot read. It blocks a new request until the user discards it. */
  invalid: boolean;
};

export function useSpaceCreationIntent(workspaceId?: string): SpaceCreationIntentState {
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

  if (!userId || !workspaceId) return { store, invalid: false };
  try {
    return { store, intent: store.snapshot(), invalid: false };
  } catch (cause) {
    // Unreadable data is actionable (Discard). A context switch is transient: the scope
    // changes and a new store reads the current account's request.
    return { store, invalid: cause instanceof InvalidSpaceCreationIntentError };
  }
}

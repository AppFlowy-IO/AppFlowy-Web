import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';

import {
  MentionSessionOutcome,
  MentionSessionSection,
  MentionSessionSource,
  MentionSessionTrigger,
  reportMentionPickerSession,
} from '@/application/services/js-services/http/mention-presentation-metrics';
import type { PanelTrigger } from '@/components/editor/components/panels/PanelsContext';

import type { MentionRequestLanes } from './mentionRequestLanes';

/** What the picker shows in one committed render. */
export interface MentionPickerView {
  /** Result options on screen. "N more", Retry and "Create" rows are no results. */
  results: number;
  /** Where the sections on screen came from. */
  source?: MentionSessionSource;
  /** A settled answer shows no result: the typed query, or the local pages, matched nothing. */
  empty: boolean;
  /** The picker shows that it could not load suggestions (unavailable, offline or busy). */
  failed: boolean;
}

/** The item a selection inserted. A created page has no rank, section or source. */
export interface MentionPickerSelection {
  /** The 1-based position among the result options on screen, across sections. */
  rank?: number;
  section?: MentionSessionSection;
  source?: MentionSessionSource;
}

interface MentionPickerSessionState {
  readonly lanes: MentionRequestLanes;
  /** When the trigger opened the picker. Every time a report gives is measured from it. */
  readonly startedAt: number;
  /** Absent for a picker a menu opened: Cloud counts only '@', '+' and '[['. */
  readonly trigger?: MentionSessionTrigger;
  readonly workspaceId?: string;
  queryLength: number;
  firstPaintAt?: number;
  serverAnswerAt?: number;
  zeroResultShown: boolean;
  /** The last render showed a failure and no result. */
  failedWithoutResults: boolean;
  selection?: MentionPickerSelection & { at: number };
  /** The session's effect was cleaned up; the session ends unless the effect runs again for it. */
  endPending: boolean;
  ended: boolean;
}

const MENTION_SESSION_TRIGGERS: Partial<Record<PanelTrigger, MentionSessionTrigger>> = {
  '@': 'at',
  '+': 'plus',
  '[[': 'page_link',
};

// The clock of every session time; PanelsContext stamps the opening with the same one.
function now() {
  return performance.now();
}

function sessionOutcome(session: MentionPickerSessionState): MentionSessionOutcome {
  if (session.selection) return 'selected';
  return session.failedWithoutResults ? 'error' : 'dismissed';
}

function endSession(session: MentionPickerSessionState) {
  if (session.ended) return;
  session.ended = true;

  const { trigger, selection, startedAt } = session;

  if (!trigger) return;

  const since = (at: number | undefined) => (at === undefined ? undefined : at - startedAt);
  const { sent, aborted } = session.lanes.requestCounts();

  // Sent only where the server advertises session_metrics_v1, and never with the query text.
  void reportMentionPickerSession(session.workspaceId, {
    trigger,
    outcome: sessionOutcome(session),
    query_len: session.queryLength,
    selected_rank: selection?.rank,
    selected_section: selection?.section,
    selected_source: selection?.source,
    time_to_first_paint_ms: since(session.firstPaintAt),
    time_to_select_ms: since(selection?.at),
    server_ms: since(session.serverAnswerAt),
    requests_sent: sent,
    requests_aborted: aborted,
    zero_result_shown: session.zeroResultShown,
  });
}

/**
 * Follows one mention picker session, from its trigger until the picker inserts an item or closes,
 * and reports it once when it ends (MEN-WEB-04). A session is one opening of the panel: one
 * `lanes` instance. Times are measured when React commits a render, just before the browser
 * paints it.
 */
export function useMentionPickerSession({
  lanes,
  trigger,
  openedAt,
  workspaceId,
  query,
  view,
}: {
  /** The open panel's request lanes; null while it is closed. */
  lanes: MentionRequestLanes | null;
  trigger?: PanelTrigger;
  /** When the panel opened, on the `performance.now()` clock. */
  openedAt?: number;
  workspaceId?: string;
  query?: string;
  view: MentionPickerView;
}) {
  const sessionRef = useRef<MentionPickerSessionState | undefined>(undefined);
  const { results, source, empty, failed } = view;

  // Records what each committed render shows. A session starts with the first render of its lanes.
  useLayoutEffect(() => {
    if (!lanes) return;

    let session = sessionRef.current;

    if (session?.lanes !== lanes) {
      session = {
        lanes,
        startedAt: openedAt ?? now(),
        trigger: trigger && MENTION_SESSION_TRIGGERS[trigger],
        workspaceId,
        queryLength: 0,
        zeroResultShown: false,
        failedWithoutResults: false,
        endPending: false,
        ended: false,
      };
      sessionRef.current = session;
    }

    if (session.ended) return;

    const committedAt = now();

    // Code points, so an emoji counts as one character.
    session.queryLength = query ? Array.from(query).length : 0;
    if (results > 0 && session.firstPaintAt === undefined) session.firstPaintAt = committedAt;
    if (source === 'server' && session.serverAnswerAt === undefined) session.serverAnswerAt = committedAt;
    if (empty) session.zeroResultShown = true;
    session.failedWithoutResults = failed && results === 0;
  }, [empty, failed, lanes, openedAt, query, results, source, trigger, workspaceId]);

  // Ends the session when the panel closes or unmounts. The end waits for a microtask: by then the
  // search effect has aborted its typed requests, which the report counts, and a replay of this
  // effect (StrictMode) has kept the session going instead.
  useEffect(() => {
    const session = sessionRef.current;

    if (!lanes || session?.lanes !== lanes) return;

    session.endPending = false;
    return () => {
      session.endPending = true;
      void Promise.resolve().then(() => {
        if (session.endPending) endSession(session);
      });
    };
  }, [lanes]);

  /**
   * Call when the user picks an option, before inserting it. The returned function records the
   * selection, timed at the pick, once the item was inserted. It belongs to the session that was
   * open at the pick, so a page created after the panel closed is never another session's pick.
   */
  const beginSelection = useCallback(() => {
    const session = sessionRef.current;
    const at = now();

    return (selection: MentionPickerSelection = {}) => {
      if (session && !session.ended) session.selection = { ...selection, at };
    };
  }, []);

  return { beginSelection };
}

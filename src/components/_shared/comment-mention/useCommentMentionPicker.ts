import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { Awareness } from 'y-protocols/awareness';

import {
  commentMentionSuggestions,
  CommentMentionRanking,
  readCommentMentionRanking,
} from '@/application/comment-mention-ranking';
import { MentionablePerson } from '@/application/types';
import { canonicalizeUserUid } from '@/application/user-uid';

/** The part of a page's collaborator awareness the picker reads. */
export type CommentMentionAwareness = Pick<Awareness, 'getStates' | 'on' | 'off'>;

const NO_ONE: ReadonlySet<string> = new Set();
const NO_SUGGESTIONS: MentionablePerson[] = [];

/**
 * Who is on the page: every collaborator the page header shows (an awareness state with a user and
 * a name), by person id, or by uid when an older client sent no person id. Sorted, each once.
 */
export function readPresentPersonIds(awareness: Pick<Awareness, 'getStates'>): string[] {
  const ids = new Set<string>();

  awareness.getStates().forEach((state) => {
    const user = state?.user as { uid?: unknown } | undefined;
    const metadata: unknown = typeof state?.metadata === 'string' ? parseMetadata(state.metadata) : null;

    if (!user || !metadata || typeof metadata !== 'object') return;

    const { user_name: name, user_uuid: uuid } = metadata as { user_name?: unknown; user_uuid?: unknown };

    if (typeof name !== 'string' || !name) return;

    const id =
      typeof uuid === 'string' && uuid
        ? uuid
        : canonicalizeUserUid(typeof user.uid === 'number' || typeof user.uid === 'string' ? user.uid : null);

    if (id) ids.add(id);
  });

  return [...ids].sort();
}

function parseMetadata(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * {@link readPresentPersonIds} of `awareness`, kept current while it is given, and empty without
 * it. The set changes only when someone arrives or leaves, not on every cursor move, so an open
 * picker does not re-render while collaborators type.
 */
export function usePresentPersonIds(awareness?: CommentMentionAwareness): ReadonlySet<string> {
  const snapshot = useRef<{ awareness?: CommentMentionAwareness; key: string; ids: ReadonlySet<string> }>({
    key: '',
    ids: NO_ONE,
  });
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!awareness) return () => undefined;
      awareness.on('change', notify);
      return () => awareness.off('change', notify);
    },
    [awareness]
  );
  const getSnapshot = useCallback(() => {
    if (!awareness) return NO_ONE;

    const ids = readPresentPersonIds(awareness);
    const key = ids.join('\n');
    const current = snapshot.current;

    if (current.awareness !== awareness || current.key !== key) {
      snapshot.current = { awareness, key, ids: ids.length ? new Set(ids) : NO_ONE };
    }

    return snapshot.current.ids;
  }, [awareness]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export interface CommentMentionPickerOptions {
  /** The text typed after the trigger `@`, or `null` while no picker is open. */
  query: string | null;
  /** The workspace roster, in the server's order. */
  people: readonly MentionablePerson[];
  /** People who took part in the discussion, the most recent first: person ids or legacy uids. */
  participantIds?: readonly string[];
  /** The page's collaborator awareness: who is on the page ranks next, while the picker is open. */
  awareness?: CommentMentionAwareness;
  /** The commenter, by person id or uid. */
  requesterId?: string | null;
}

export interface CommentMentionPicker {
  /** The people to suggest, best first; empty while no picker is open. */
  suggestions: MentionablePerson[];
  /** The highlighted suggestion; 0 when there is none. */
  activeIndex: number;
  /** Highlights the suggestion at `index`, as a pointer over it does. */
  setActiveIndex: (index: number) => void;
  /** Moves the highlight by `delta`, wrapping at either end. */
  moveActive: (delta: number) => void;
  /** Highlights the first suggestion again, for a new query. */
  resetActive: () => void;
  /** The order this picker uses, read once when it mounts. */
  ranking: CommentMentionRanking;
}

interface ActiveSuggestion {
  index: number;
  /** The highlighted person, followed when the list changes without a new query. */
  personId?: string;
}

const FIRST_SUGGESTION: ActiveSuggestion = { index: 0 };

/**
 * The @ picker of a comment composer (MEN-WEB-14): the people to suggest for `query`, in the order
 * `readCommentMentionRanking` picks, and the highlighted one. Row comments, Feed cards and document
 * comments share it; each composer keeps its own trigger, keys and insertion.
 *
 * The highlight stays on its person when the list changes without a new query (the roster loads,
 * a comment arrives, someone joins the page), so Enter inserts the person the user chose. Presence
 * is read only while a ranked picker is open.
 */
export function useCommentMentionPicker({
  query,
  people,
  participantIds,
  awareness,
  requesterId,
}: CommentMentionPickerOptions): CommentMentionPicker {
  const [ranking] = useState(readCommentMentionRanking);
  const ranked = ranking === 'ranked';
  const presentIds = usePresentPersonIds(ranked && query !== null ? awareness : undefined);
  const suggestions = useMemo(
    () =>
      query === null
        ? NO_SUGGESTIONS
        : commentMentionSuggestions(ranking, { query, people, participantIds, presentIds, requesterId }),
    [participantIds, people, presentIds, query, ranking, requesterId]
  );
  const [active, setActive] = useState<ActiveSuggestion>(FIRST_SUGGESTION);
  const kept = active.personId ? suggestions.findIndex((person) => person.person_id === active.personId) : -1;
  const activeIndex = kept >= 0 ? kept : Math.min(active.index, Math.max(0, suggestions.length - 1));

  const highlight = useCallback(
    (index: number) => {
      const personId = suggestions[index]?.person_id;

      // A pointer moving over the highlighted option changes nothing, and renders nothing.
      setActive((current) => (current.index === index && current.personId === personId ? current : { index, personId }));
    },
    [suggestions]
  );
  const moveActive = useCallback(
    (delta: number) => {
      const count = suggestions.length;

      if (count) highlight((((activeIndex + delta) % count) + count) % count);
    },
    [activeIndex, highlight, suggestions.length]
  );
  const resetActive = useCallback(() => setActive(FIRST_SUGGESTION), []);

  return { suggestions, activeIndex, setActiveIndex: highlight, moveActive, resetActive, ranking };
}

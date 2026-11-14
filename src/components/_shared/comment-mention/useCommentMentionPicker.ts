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
 * Who is on the page, sorted, each once: the collaborators the page header shows (an awareness
 * state with a user and a name) that name themselves exactly. Web sends its person id
 * (`metadata.user_uuid`). Desktop sends none, and its `user.uid` is an i64 JSON number, which
 * `JSON.parse` rounds above 2^53, as Cloud's uids are; its exact uid is the string `metadata.id`.
 * So a collaborator is their person id, else `metadata.id`, else `user.uid` while it is a string
 * or a safe integer. One who names none of them (a Desktop build that sends no `metadata.id`) is
 * shown by the header but not counted here.
 */
export function readPresentPersonIds(awareness: Pick<Awareness, 'getStates'>): string[] {
  const ids = new Set<string>();

  awareness.getStates().forEach((state) => {
    const user = state?.user as { uid?: unknown } | undefined;
    const metadata: unknown = typeof state?.metadata === 'string' ? parseMetadata(state.metadata) : null;

    if (!user || !metadata || typeof metadata !== 'object') return;

    const {
      user_name: name,
      user_uuid: uuid,
      id: uid,
    } = metadata as { user_name?: unknown; user_uuid?: unknown; id?: unknown };

    if (typeof name !== 'string' || !name) return;

    const id = typeof uuid === 'string' && uuid ? uuid : exactUid(uid) ?? exactUid(user.uid);

    if (id) ids.add(id);
  });

  return [...ids].sort();
}

/** `value` as a canonical uid while it is a decimal string or a safe integer; a rounded number is none. */
function exactUid(value: unknown): string | null {
  return typeof value === 'string' || typeof value === 'number' ? canonicalizeUserUid(value) : null;
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
  /**
   * The highlighted person, followed when the list changes without a new query. Unset only until
   * the list shows someone at `index`, who is then pinned.
   */
  personId?: string;
}

const FIRST_SUGGESTION: ActiveSuggestion = { index: 0 };

/**
 * The @ picker of a comment composer (MEN-WEB-14): the people to suggest for `query`, in the order
 * `readCommentMentionRanking` picks, and the highlighted one. Row comments, Feed cards and document
 * comments share it; each composer keeps its own trigger, keys and insertion.
 *
 * The highlight stays on the person it shows when the list changes without a new query (the
 * roster loads or arrives in another order, a comment arrives, someone joins or leaves the page),
 * so Enter inserts the person on screen. That holds from the first render of a list, before the
 * user moves the highlight; `resetActive` highlights the first suggestion of the next list. When
 * the person leaves the list, the highlight keeps its place and follows whoever is shown there.
 * Presence is read only while a ranked picker is open.
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
  const kept =
    active.personId === undefined
      ? -1
      : suggestions[active.index]?.person_id === active.personId
      ? active.index
      : suggestions.findIndex((person) => person.person_id === active.personId);
  const activeIndex = kept >= 0 ? kept : Math.min(active.index, Math.max(0, suggestions.length - 1));
  const shownId = suggestions[activeIndex]?.person_id;

  // Pin the highlight to the person on screen, the default first suggestion included. React
  // renders again at once, before committing, and the second pass finds nothing to change.
  if (shownId !== undefined && (shownId !== active.personId || activeIndex !== active.index)) {
    setActive({ index: activeIndex, personId: shownId });
  }

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

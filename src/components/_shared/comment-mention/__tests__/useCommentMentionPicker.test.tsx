import { act, renderHook } from '@testing-library/react';

import { COMMENT_MENTION_RANKING_OVERRIDE_KEY } from '@/application/comment-mention-ranking';
import { MentionablePerson, MentionPersonRole } from '@/application/types';

import {
  CommentMentionAwareness,
  CommentMentionPickerOptions,
  readPresentPersonIds,
  useCommentMentionPicker,
  usePresentPersonIds,
} from '../useCommentMentionPicker';

function person(uid: number, name: string): MentionablePerson {
  return {
    uid: String(uid),
    person_id: `00000000-0000-4000-8000-${String(uid).padStart(12, '0')}`,
    name,
    email: `${name.toLowerCase()}@appflowy.io`,
    role: MentionPersonRole.Member,
    avatar_url: null,
    cover_image_url: null,
    custom_image_url: null,
    description: null,
    invited: false,
    last_mentioned_at: null,
  };
}

const ada = person(1, 'Ada');
const bob = person(2, 'Bob');
const cy = person(3, 'Cy');
const roster = [ada, bob, cy];
const names = (people: readonly MentionablePerson[]) => people.map((entry) => entry.name);

interface FakeState {
  user?: { uid: unknown; device_id?: string };
  metadata?: string;
}

function state(name: string, uuid?: string, uid: unknown = 1): FakeState {
  return { user: { uid, device_id: `${name}-device` }, metadata: JSON.stringify({ user_name: name, user_uuid: uuid }) };
}

/** A Cloud uid: a Snowflake id far above 2^53. */
const DESKTOP_UID = '626259007224418304';

/**
 * A Desktop collaborator's state as y-protocols hands it to Web: `JSON.parse` of what Desktop's Rust
 * core writes (`DocumentAwarenessState`, `uid` an i64 JSON number), with Desktop's metadata
 * (`document_bloc.dart`: its uid as the string `id`, no `user_uuid`).
 */
function desktopState(name: string, uid = DESKTOP_UID, metadata: Record<string, unknown> = { id: uid }): FakeState {
  const fields = JSON.stringify({
    ...metadata,
    cursor_color: '0xff00b5ff',
    selection_color: '0x9900b5ff',
    user_name: name,
    user_email: `${name.toLowerCase()}@appflowy.io`,
    user_avatar: '',
  });

  return JSON.parse(
    `{"version":1,"user":{"uid":${uid},"device_id":"${name}-desktop"},"selection":null,` +
      `"metadata":${JSON.stringify(fields)},"timestamp":1}`
  ) as FakeState;
}

/** An awareness whose states the test edits, emitting `change` on demand. */
function createAwareness(initial: FakeState[] = []) {
  const states = new Map<number, FakeState>(initial.map((entry, index) => [index + 1, entry]));
  const listeners = new Set<() => void>();
  const awareness = {
    getStates: () => states,
    on: jest.fn((event: string, listener: () => void) => {
      if (event === 'change') listeners.add(listener);
    }),
    off: jest.fn((event: string, listener: () => void) => {
      if (event === 'change') listeners.delete(listener);
    }),
  };

  return {
    awareness: awareness as unknown as CommentMentionAwareness & typeof awareness,
    states,
    listeners,
    emit: () => act(() => listeners.forEach((listener) => listener())),
  };
}

describe('readPresentPersonIds', () => {
  it('reads person ids, falls back to uids, and skips states the page header would not show', () => {
    const { awareness } = createAwareness([
      state('Bob', bob.person_id, 2),
      state('Ada', undefined, 1),
      state('Ada again', undefined, '1'),
      state('', cy.person_id),
      { user: { uid: 4 } },
      { user: { uid: 5 }, metadata: 'not json' },
      { metadata: JSON.stringify({ user_name: 'No user', user_uuid: 'x' }) },
      state('Huge uid', undefined, 2 ** 60),
      state('Bob on a phone', bob.person_id, 2),
    ]);

    expect(readPresentPersonIds(awareness)).toEqual([bob.person_id, '1'].sort());
  });

  it('names a Desktop collaborator by the exact uid in its metadata, not the rounded user.uid', () => {
    const zed = desktopState('Zed');

    // The premise: the uid Desktop writes as a JSON number arrives rounded.
    expect(Number.isSafeInteger(zed.user?.uid)).toBe(false);
    expect(String(zed.user?.uid)).not.toBe(DESKTOP_UID);

    const { awareness } = createAwareness([
      zed,
      // A Desktop build that sends no metadata id names no one; an id that is no uid falls back.
      desktopState('Old desktop', '626259007224418305', {}),
      desktopState('Odd id', '7', { id: 'not-a-uid' }),
      // A person id wins over a uid.
      { user: { uid: 8 }, metadata: JSON.stringify({ id: '8', user_name: 'Web', user_uuid: ada.person_id }) },
    ]);

    expect(readPresentPersonIds(awareness)).toEqual([DESKTOP_UID, '7', ada.person_id].sort());
  });
});

describe('usePresentPersonIds', () => {
  it('is empty without awareness, and changes only when someone arrives or leaves', () => {
    const { awareness, states, listeners, emit } = createAwareness([state('Ada', ada.person_id)]);
    let renders = 0;
    const { result, rerender, unmount } = renderHook(
      ({ source }: { source?: CommentMentionAwareness }) => {
        renders += 1;
        return usePresentPersonIds(source);
      },
      { initialProps: { source: undefined as CommentMentionAwareness | undefined } }
    );

    expect(result.current.size).toBe(0);
    expect(awareness.on).not.toHaveBeenCalled();

    rerender({ source: awareness });
    expect([...result.current]).toEqual([ada.person_id]);
    expect(listeners.size).toBe(1);

    const first = result.current;
    const rendered = renders;

    // A cursor move changes a state but not who is here.
    states.set(1, { ...state('Ada', ada.person_id), user: { uid: 1, device_id: 'moved' } });
    emit();
    expect(result.current).toBe(first);
    expect(renders).toBe(rendered);

    states.set(2, state('Bob', bob.person_id));
    emit();
    expect([...result.current]).toEqual([ada.person_id, bob.person_id].sort());

    states.delete(2);
    emit();
    expect([...result.current]).toEqual([ada.person_id]);

    unmount();
    expect(listeners.size).toBe(0);
  });
});

describe('useCommentMentionPicker', () => {
  afterEach(() => window.localStorage.clear());

  const renderPicker = (options: Partial<CommentMentionPickerOptions> = {}) =>
    renderHook((props: CommentMentionPickerOptions) => useCommentMentionPicker(props), {
      initialProps: { query: '', people: roster, ...options },
    });

  it("keeps today's order by default, ignoring the discussion and the page", () => {
    const { awareness } = createAwareness([state('Cy', cy.person_id)]);
    const { result } = renderPicker({ participantIds: [bob.person_id], awareness, requesterId: ada.person_id });

    expect(result.current.ranking).toBe('legacy');
    expect(names(result.current.suggestions)).toEqual(['Ada', 'Bob', 'Cy']);
    expect(awareness.on).not.toHaveBeenCalled();
  });

  it('ranks participants, then who is on the page, with the requester last, once ranked', () => {
    window.localStorage.setItem(COMMENT_MENTION_RANKING_OVERRIDE_KEY, 'ranked');
    const { awareness, states, emit } = createAwareness([state('Cy', cy.person_id)]);
    const { result, rerender } = renderPicker({
      query: null,
      participantIds: [bob.person_id],
      awareness,
      requesterId: ada.person_id,
    });

    expect(result.current.ranking).toBe('ranked');
    expect(result.current.suggestions).toEqual([]);
    // Presence is read only while the picker is open.
    expect(awareness.on).not.toHaveBeenCalled();

    rerender({ query: '', people: roster, participantIds: [bob.person_id], awareness, requesterId: ada.person_id });
    expect(names(result.current.suggestions)).toEqual(['Bob', 'Cy', 'Ada']);
    expect(awareness.on).toHaveBeenCalledTimes(1);

    rerender({ query: '', people: roster, participantIds: [], awareness, requesterId: ada.person_id });
    expect(names(result.current.suggestions)).toEqual(['Cy', 'Bob', 'Ada']);

    // Cy leaves the page.
    states.clear();
    emit();
    expect(names(result.current.suggestions)).toEqual(['Bob', 'Cy', 'Ada']);
    rerender({ query: '', people: roster, participantIds: [], awareness, requesterId: null });
    expect(names(result.current.suggestions)).toEqual(['Ada', 'Bob', 'Cy']);

    rerender({ query: null, people: roster, participantIds: [], awareness, requesterId: null });
    expect(awareness.off).toHaveBeenCalledTimes(1);
    expect(awareness.on).toHaveBeenCalledTimes(1);
  });

  it('ranks a Desktop collaborator on the page by the uid the roster gives, once ranked', () => {
    window.localStorage.setItem(COMMENT_MENTION_RANKING_OVERRIDE_KEY, 'ranked');
    // Cloud sends the roster's uid as a decimal string.
    const zed = { ...person(4, 'Zed'), uid: DESKTOP_UID };
    const { awareness } = createAwareness([desktopState('Zed')]);
    const { result } = renderPicker({ people: [ada, zed], awareness });

    expect(names(result.current.suggestions)).toEqual(['Zed', 'Ada']);
  });

  it('reads the order once, when it mounts', () => {
    const { result, rerender } = renderPicker({ query: 'b', participantIds: [cy.person_id] });

    window.localStorage.setItem(COMMENT_MENTION_RANKING_OVERRIDE_KEY, 'ranked');
    rerender({ query: 'bo', people: roster, participantIds: [cy.person_id] });
    expect(result.current.ranking).toBe('legacy');
    expect(renderPicker().result.current.ranking).toBe('ranked');
  });

  it('wraps the highlight at either end and starts again at the first suggestion', () => {
    const { result } = renderPicker();

    act(() => result.current.moveActive(-1));
    expect(result.current.activeIndex).toBe(2);
    act(() => result.current.moveActive(1));
    expect(result.current.activeIndex).toBe(0);
    act(() => result.current.setActiveIndex(1));
    expect(result.current.activeIndex).toBe(1);
    act(() => result.current.resetActive());
    expect(result.current.activeIndex).toBe(0);
  });

  it('does not render again while the pointer moves over the highlighted option', () => {
    let renders = 0;
    const { result } = renderHook(() => {
      renders += 1;
      return useCommentMentionPicker({ query: '', people: roster });
    });

    act(() => result.current.setActiveIndex(1));
    act(() => result.current.setActiveIndex(1));

    const rendered = renders;

    act(() => result.current.setActiveIndex(1));
    act(() => result.current.setActiveIndex(1));
    expect(renders).toBe(rendered);
    expect(result.current.activeIndex).toBe(1);
  });

  it('keeps the highlight on its person when the list changes without a new query', () => {
    const dee = person(5, 'Dee');
    const { result, rerender } = renderPicker();

    act(() => result.current.setActiveIndex(1));
    expect(result.current.suggestions[result.current.activeIndex]).toBe(bob);

    // The roster arrives again in another order: Enter must still insert Bob.
    rerender({ query: '', people: [cy, ada, bob] });
    expect(result.current.suggestions[result.current.activeIndex]).toBe(bob);

    // Once Bob is gone the highlight keeps the place Bob had on screen, then follows who is there.
    rerender({ query: '', people: [cy, ada, dee] });
    expect(result.current.activeIndex).toBe(2);
    rerender({ query: '', people: [ada, dee, cy] });
    expect(result.current.suggestions[result.current.activeIndex]).toBe(dee);

    // The place stays within the list.
    rerender({ query: '', people: [cy] });
    expect(result.current.activeIndex).toBe(0);

    rerender({ query: null, people: [cy] });
    expect(result.current.suggestions).toEqual([]);
    expect(result.current.activeIndex).toBe(0);
    act(() => result.current.moveActive(1));
    expect(result.current.activeIndex).toBe(0);
  });

  it('keeps the first suggestion on its person when the roster arrives in another order', () => {
    const { result, rerender } = renderPicker();

    expect(result.current.suggestions[result.current.activeIndex]).toBe(ada);

    // The server's roster replaces the cached one before the user moves the highlight.
    rerender({ query: '', people: [cy, bob, ada] });
    expect(result.current.activeIndex).toBe(2);
    expect(result.current.suggestions[result.current.activeIndex]).toBe(ada);

    // A new query highlights its own first suggestion again.
    act(() => result.current.resetActive());
    expect(result.current.activeIndex).toBe(0);
    rerender({ query: '', people: [ada, bob, cy] });
    expect(result.current.suggestions[result.current.activeIndex]).toBe(cy);
  });

  it('keeps the first suggestion on its person when someone leaves the page, once ranked', () => {
    window.localStorage.setItem(COMMENT_MENTION_RANKING_OVERRIDE_KEY, 'ranked');
    const { awareness, states, emit } = createAwareness([state('Cy', cy.person_id)]);
    const { result } = renderPicker({ awareness });

    expect(names(result.current.suggestions)).toEqual(['Cy', 'Ada', 'Bob']);
    expect(result.current.activeIndex).toBe(0);

    // Cy leaves before the user moves the highlight: Enter must still insert Cy.
    states.clear();
    emit();
    expect(names(result.current.suggestions)).toEqual(['Ada', 'Bob', 'Cy']);
    expect(result.current.suggestions[result.current.activeIndex]).toBe(cy);
  });

  it('can highlight a person listed twice at either place', () => {
    const { result } = renderPicker({ people: [ada, bob, ada] });

    act(() => result.current.moveActive(-1));
    expect(result.current.activeIndex).toBe(2);
    act(() => result.current.moveActive(-1));
    expect(result.current.activeIndex).toBe(1);
  });
});

import { debounce } from 'lodash-es';
import {
  createContext,
  lazy,
  ReactNode,
  Suspense,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { BaseRange, Editor, Path, Transforms } from 'slate';
import { ReactEditor, useSlate } from 'slate-react';

import { APP_EVENTS } from '@/application/constants';
import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { notify } from '@/components/_shared/notify';
import { useEventEmitter } from '@/components/app/app.hooks';
import { useEditorContext } from '@/components/editor/EditorContext';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';

import { findMatches, pathToKey } from './searchUtils';

// Lazy-loaded so the panel's icons/buttons/tooltip code only ship when a user
// actually opens find & replace, mirroring DocumentHistoryModal's pattern.
const FindReplacePanel = lazy(() => import('./FindReplacePanel'));

const MATCH_CLASS = 'search-match-highlight';
const CURRENT_MATCH_CLASS = 'search-match-highlight search-match-highlight-current';
const SEARCH_DEBOUNCE_MS = 200;

/** Cheap structural equality for two ordered lists of match ranges. */
function rangesEqual(a: BaseRange[], b: BaseRange[]): boolean {
  if (a.length !== b.length) return false;

  for (let i = 0; i < a.length; i++) {
    const ra = a[i];
    const rb = b[i];

    if (ra.anchor.offset !== rb.anchor.offset || ra.focus.offset !== rb.focus.offset) return false;
    if (!Path.equals(ra.anchor.path, rb.anchor.path) || !Path.equals(ra.focus.path, rb.focus.path)) return false;
  }

  return true;
}

export interface FindReplaceContextValue {
  open: boolean;
  showReplace: boolean;
  query: string;
  replaceText: string;
  caseSensitive: boolean;
  readOnly: boolean;
  /** Total number of matches found for the current query. */
  matchCount: number;
  /** Zero-based index of the active match, or -1 when there are none. */
  currentIndex: number;
  /** Increments each time the panel is asked to open, so it can (re)focus its input. */
  focusToken: number;
  setQuery: (value: string) => void;
  setReplaceText: (value: string) => void;
  setShowReplace: (value: boolean) => void;
  toggleCaseSensitive: () => void;
  goToNext: () => void;
  goToPrevious: () => void;
  replaceCurrent: () => void;
  replaceAll: () => void;
  close: () => void;
}

/**
 * Decorations are intentionally kept in a separate context so that the editor
 * surface (which only needs `getMatchDecorations`) doesn't re-render on every
 * find-input keystroke — it re-renders only when match positions actually change.
 */
export interface FindReplaceDecorationsValue {
  /** Decoration ranges (with highlight class) for a given text-node path. */
  getMatchDecorations: (path: Path) => (BaseRange & { class_name: string })[];
}

const noop = () => undefined;

const defaultValue: FindReplaceContextValue = {
  open: false,
  showReplace: false,
  query: '',
  replaceText: '',
  caseSensitive: false,
  readOnly: true,
  matchCount: 0,
  currentIndex: -1,
  focusToken: 0,
  setQuery: noop,
  setReplaceText: noop,
  setShowReplace: noop,
  toggleCaseSensitive: noop,
  goToNext: noop,
  goToPrevious: noop,
  replaceCurrent: noop,
  replaceAll: noop,
  close: noop,
};

const defaultDecorationsValue: FindReplaceDecorationsValue = {
  getMatchDecorations: () => [],
};

const FindReplaceContext = createContext<FindReplaceContextValue>(defaultValue);
const FindReplaceDecorationsContext =
  createContext<FindReplaceDecorationsValue>(defaultDecorationsValue);

export function useFindReplace() {
  return useContext(FindReplaceContext);
}

/** Narrow hook for the editor surface — only re-renders when decorations change. */
export function useFindReplaceDecorations() {
  return useContext(FindReplaceDecorationsContext);
}

export function FindReplaceProvider({ children }: { children: ReactNode }) {
  const editor = useSlate() as YjsEditor;
  const { viewId, readOnly } = useEditorContext();
  const eventEmitter = useEventEmitter();
  const { t } = useTranslation();

  const [open, setOpen] = useState(false);
  const [showReplace, setShowReplace] = useState(false);
  const [query, setQueryState] = useState('');
  const [replaceText, setReplaceText] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [matches, setMatches] = useState<BaseRange[]>([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [focusToken, setFocusToken] = useState(0);

  // Refs mirror the latest state for use inside long-lived listeners / handlers
  // that must not be recreated on every keystroke.
  const matchesRef = useRef(matches);
  const currentIndexRef = useRef(currentIndex);
  const queryRef = useRef(query);
  const caseSensitiveRef = useRef(caseSensitive);
  const replaceTextRef = useRef(replaceText);
  const openRef = useRef(open);

  useEffect(() => {
    openRef.current = open;
  }, [open]);
  useEffect(() => {
    matchesRef.current = matches;
  }, [matches]);
  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);
  useEffect(() => {
    queryRef.current = query;
  }, [query]);
  useEffect(() => {
    caseSensitiveRef.current = caseSensitive;
  }, [caseSensitive]);
  useEffect(() => {
    replaceTextRef.current = replaceText;
  }, [replaceText]);

  const recompute = useCallback(
    (nextQuery: string, nextCaseSensitive: boolean, options?: { resetIndex?: boolean }): BaseRange[] => {
      const next = findMatches(editor, nextQuery, nextCaseSensitive);

      // Keep the previous reference when nothing changed so the live-resync
      // effect below cannot loop and decorations don't needlessly re-render.
      setMatches((prev) => (rangesEqual(prev, next) ? prev : next));
      setCurrentIndex((prev) => {
        if (next.length === 0) return -1;
        if (options?.resetIndex || prev < 0) return 0;
        return Math.min(prev, next.length - 1);
      });
      // Return the freshly-computed matches so callers (e.g. replace handlers)
      // can act on the up-to-date result without waiting for the ref sync effect.
      return next;
    },
    [editor]
  );

  const debouncedRecompute = useMemo(
    () => debounce((q: string, cs: boolean) => recompute(q, cs, { resetIndex: true }), SEARCH_DEBOUNCE_MS),
    [recompute]
  );

  // A non-resetting recompute used to keep highlights aligned with live edits.
  const debouncedResync = useMemo(
    () => debounce((q: string, cs: boolean) => recompute(q, cs), SEARCH_DEBOUNCE_MS),
    [recompute]
  );

  useEffect(() => () => debouncedRecompute.cancel(), [debouncedRecompute]);
  useEffect(() => () => debouncedResync.cancel(), [debouncedResync]);

  // The provider re-renders on every editor change (via useSlate). While the
  // panel is open, re-run the search so matches track the document content.
  // recompute() preserves the matches reference when unchanged, so this settles.
  useEffect(() => {
    if (!openRef.current || !queryRef.current) return;
    debouncedResync(queryRef.current, caseSensitiveRef.current);
  });

  const setQuery = useCallback(
    (value: string) => {
      setQueryState(value);
      debouncedRecompute(value, caseSensitiveRef.current);
    },
    [debouncedRecompute]
  );

  const toggleCaseSensitive = useCallback(() => {
    setCaseSensitive((prev) => {
      const next = !prev;

      // Drop any pending debounced search scheduled with the *previous*
      // case-sensitivity, otherwise it would fire after this sync recompute
      // and overwrite the just-computed exact-case results.
      debouncedRecompute.cancel();
      debouncedResync.cancel();
      recompute(queryRef.current, next, { resetIndex: true });
      return next;
    });
  }, [debouncedRecompute, debouncedResync, recompute]);

  const scrollToMatch = useCallback(
    (index: number) => {
      const range = matchesRef.current[index];

      if (!range) return;

      try {
        const domRange = ReactEditor.toDOMRange(editor, range);
        const node = domRange.startContainer.parentElement;

        node?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      } catch {
        // The match may not be mounted yet (e.g. inside a collapsed toggle); ignore.
      }
    },
    [editor]
  );

  // Scroll the active match into view whenever it changes while the panel is open.
  useEffect(() => {
    if (!open || currentIndex < 0) return;
    scrollToMatch(currentIndex);
  }, [open, currentIndex, scrollToMatch]);

  const goToNext = useCallback(() => {
    const length = matchesRef.current.length;

    if (length === 0) return;
    setCurrentIndex((prev) => (prev + 1) % length);
  }, []);

  const goToPrevious = useCallback(() => {
    const length = matchesRef.current.length;

    if (length === 0) return;
    setCurrentIndex((prev) => (prev - 1 + length) % length);
  }, []);

  const replaceCurrent = useCallback(() => {
    if (readOnly) return;
    // The find input feeds setQuery() which schedules a debounced recompute.
    // If the user types a new query then clicks Replace within the 200ms window,
    // matchesRef still points to the previous query's ranges. Cancel any pending
    // recompute and run a synchronous one, using its return value directly so we
    // don't read from matchesRef (which only updates after the next render).
    debouncedRecompute.cancel();
    debouncedResync.cancel();
    const fresh = recompute(queryRef.current, caseSensitiveRef.current);

    if (fresh.length === 0) return;
    const index = Math.min(Math.max(currentIndexRef.current, 0), fresh.length - 1);
    const range = fresh[index];

    if (!range) return;

    ReactEditor.focus(editor);
    Editor.withoutNormalizing(editor, () => {
      const start = Editor.start(editor, range);

      Transforms.delete(editor, { at: range });
      if (replaceTextRef.current) {
        Transforms.insertText(editor, replaceTextRef.current, { at: start });
      }
    });

    recompute(queryRef.current, caseSensitiveRef.current);
  }, [debouncedRecompute, debouncedResync, editor, readOnly, recompute]);

  const replaceAll = useCallback(() => {
    if (readOnly) return;
    // Same staleness guard as replaceCurrent — flush any pending search and
    // operate on the freshly-computed match list, not the (possibly stale) ref.
    debouncedRecompute.cancel();
    debouncedResync.cancel();
    const all = recompute(queryRef.current, caseSensitiveRef.current, { resetIndex: true });

    if (all.length === 0) return;
    const count = all.length;

    ReactEditor.focus(editor);
    Editor.withoutNormalizing(editor, () => {
      // Replace from the last match backwards so earlier offsets stay valid.
      for (let i = all.length - 1; i >= 0; i--) {
        const range = all[i];
        const start = Editor.start(editor, range);

        Transforms.delete(editor, { at: range });
        if (replaceTextRef.current) {
          Transforms.insertText(editor, replaceTextRef.current, { at: start });
        }
      }
    });

    recompute(queryRef.current, caseSensitiveRef.current, { resetIndex: true });
    notify.success(
      count === 1
        ? t('findAndReplace.replacedOneSuccessfully')
        : t('findAndReplace.replacedMoreThanOneSuccessfully').replace('{}', String(count))
    );
  }, [debouncedRecompute, debouncedResync, editor, readOnly, recompute, t]);

  const close = useCallback(() => {
    setOpen(false);
    setMatches([]);
    setCurrentIndex(-1);
  }, []);

  const openPanel = useCallback(
    (options?: { showReplace?: boolean }) => {
      setOpen(true);
      setFocusToken((token) => token + 1);
      if (options?.showReplace !== undefined) {
        setShowReplace(options.showReplace);
      }

      // Seed the query from an active text selection, like native browser find.
      let initialQuery = queryRef.current;
      const selection = editor.selection;

      if (selection && ReactEditor.hasRange(editor, selection)) {
        const selected = CustomEditor.getSelectionContent(editor, selection);

        if (selected && !selected.includes('\n')) {
          initialQuery = selected;
          setQueryState(selected);
        }
      }

      recompute(initialQuery, caseSensitiveRef.current, { resetIndex: true });
    },
    [editor, recompute]
  );

  const openPanelRef = useRef(openPanel);

  useEffect(() => {
    openPanelRef.current = openPanel;
  }, [openPanel]);

  // Open the panel when the header "Find and replace" menu item targets this view.
  useEffect(() => {
    if (!eventEmitter) return;
    const handler = (payload?: { viewId?: string }) => {
      if (payload?.viewId && payload.viewId !== viewId) return;
      openPanelRef.current({ showReplace: true });
    };

    eventEmitter.on(APP_EVENTS.FIND_AND_REPLACE, handler);
    return () => {
      eventEmitter.off(APP_EVENTS.FIND_AND_REPLACE, handler);
    };
  }, [eventEmitter, viewId]);

  // Cmd/Ctrl+F inside this editor opens the in-document find panel.
  useEffect(() => {
    let dom: HTMLElement | null = null;

    try {
      dom = ReactEditor.toDOMNode(editor, editor);
    } catch {
      return;
    }

    const handler = (event: KeyboardEvent) => {
      if (!createHotkey(HOT_KEY_NAME.FIND_REPLACE)(event)) return;
      event.preventDefault();
      event.stopPropagation();
      openPanelRef.current();
    };

    dom.addEventListener('keydown', handler);
    return () => {
      dom?.removeEventListener('keydown', handler);
    };
  }, [editor]);

  const decorationsByPath = useMemo(() => {
    const map = new Map<string, (BaseRange & { class_name: string })[]>();

    matches.forEach((range, index) => {
      const key = pathToKey(range.anchor.path);
      const list = map.get(key) ?? [];

      list.push({ ...range, class_name: index === currentIndex ? CURRENT_MATCH_CLASS : MATCH_CLASS });
      map.set(key, list);
    });

    return map;
  }, [matches, currentIndex]);

  const getMatchDecorations = useCallback(
    (path: Path) => {
      if (!open) return [];
      return decorationsByPath.get(pathToKey(path)) ?? [];
    },
    [open, decorationsByPath]
  );

  const value = useMemo<FindReplaceContextValue>(
    () => ({
      open,
      showReplace,
      query,
      replaceText,
      caseSensitive,
      readOnly,
      matchCount: matches.length,
      currentIndex,
      focusToken,
      setQuery,
      setReplaceText,
      setShowReplace,
      toggleCaseSensitive,
      goToNext,
      goToPrevious,
      replaceCurrent,
      replaceAll,
      close,
    }),
    [
      open,
      showReplace,
      query,
      replaceText,
      caseSensitive,
      readOnly,
      matches.length,
      currentIndex,
      focusToken,
      setQuery,
      setReplaceText,
      setShowReplace,
      toggleCaseSensitive,
      goToNext,
      goToPrevious,
      replaceCurrent,
      replaceAll,
      close,
    ]
  );

  const decorationsValue = useMemo<FindReplaceDecorationsValue>(
    () => ({ getMatchDecorations }),
    [getMatchDecorations]
  );

  return (
    <FindReplaceDecorationsContext.Provider value={decorationsValue}>
      <FindReplaceContext.Provider value={value}>
        {children}
        {open && (
          <Suspense fallback={null}>
            <FindReplacePanel />
          </Suspense>
        )}
      </FindReplaceContext.Provider>
    </FindReplaceDecorationsContext.Provider>
  );
}

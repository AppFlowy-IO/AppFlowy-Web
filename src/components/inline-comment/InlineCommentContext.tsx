import type EventEmitter from 'events';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Editor, Operation, Range, RangeRef, Transforms } from 'slate';
import { ReactEditor } from 'slate-react';
import { validate as uuidValidate } from 'uuid';

import { APP_EVENTS } from '@/application/constants';
import { InlineComment, InlineCommentReaction } from '@/application/inline-comment';
import { InlineCommentService } from '@/application/services/domains';
import { YjsEditor } from '@/application/slate-yjs';
import { useCurrentUserOptional } from '@/components/main/app.hooks';

import {
  addInlineCommentAnchor,
  applyAuthorizedInlineCommentUpdate,
  collectInlineCommentAnchors,
  getInlineCommentSelection,
  INLINE_COMMENT_IDS_KEY,
  InlineCommentAnchor,
  InlineCommentSelection,
  inlineCommentAnchorsEqual,
  removeInlineCommentAnchor,
} from './editor/anchors';

export const INLINE_COMMENT_DRAWER_WIDTH = 352;

const ANCHOR_REFRESH_RETRY_INTERVAL = 300;
const ANCHOR_REFRESH_MAX_ATTEMPTS = 20;

function hasAnchorsForTopLevelComments(
  comments: InlineComment[],
  anchors: ReadonlyMap<string, InlineCommentAnchor>
): boolean {
  return comments.every((comment) => comment.replyCommentId || comment.isDeleted || anchors.has(comment.commentId));
}

/**
 * Collecting the anchors walks every text node in the document, and Slate calls
 * `onChange` for every operation batch — including caret moves. Skip the walk
 * whenever the batch provably cannot have touched an anchor, so a document
 * without comments pays nothing for having the feature available.
 */
export function operationsCanAffectAnchors(operations: readonly Operation[], hasAnchors: boolean): boolean {
  for (const operation of operations) {
    // Moving the selection never adds, moves or drops an anchor.
    if (operation.type === 'set_selection') continue;

    // Once anchors exist any content change can shift or delete one.
    if (hasAnchors) return true;

    // With no anchors in the document, the only ways one can appear are an
    // explicit id write and content arriving from a paste or a remote peer.
    if (operation.type === 'insert_node') return true;
    if (operation.type === 'set_node' && INLINE_COMMENT_IDS_KEY in operation.newProperties) return true;
    // Partial Y.Text formats are translated into split_node operations. In
    // particular, the leading split carries the new attributes and may be the
    // only evidence that the first remote anchor arrived.
    if (operation.type === 'split_node' && INLINE_COMMENT_IDS_KEY in operation.properties) return true;
    if (operation.type === 'merge_node') return true;
  }

  return false;
}

export type InlineCommentFilter = 'open' | 'resolved' | 'all';

interface PendingInlineComment {
  selection: InlineCommentSelection;
  rangeRef: RangeRef;
  rect: Pick<DOMRect, 'bottom' | 'left' | 'right' | 'top'>;
}

interface RegisterInlineCommentEditorOptions {
  canComment: boolean;
  canWrite: boolean;
  readOnly: boolean;
  viewId: string;
}

interface InlineCommentEditorBridgeValue {
  handleEditorChange: (editor: YjsEditor) => void;
  refreshAnchors: (editor: YjsEditor) => void;
  registerEditor: (editor: YjsEditor, options: RegisterInlineCommentEditorOptions) => () => void;
  updateEditorAccess: (editor: YjsEditor, options: RegisterInlineCommentEditorOptions) => void;
}

interface InlineCommentLeafContextValue {
  active: boolean;
  focusedCommentId: string | null;
  openCommentFromAnchor: (commentIds: readonly string[]) => void;
}

/**
 * The card actions. Every callback here reads its mutable inputs from a ref, so
 * this value only changes identity when the provider is pointed at a different
 * document — a comment card's buttons never re-render for an unrelated anchor,
 * filter or mutation update.
 */
interface InlineCommentActionsContextValue {
  createReply: (parentCommentId: string, content: string) => Promise<void>;
  deleteComment: (commentId: string) => Promise<void>;
  focusComment: (commentId: string) => void;
  resolveComment: (commentId: string, isResolved: boolean) => Promise<void>;
  toggleReaction: (commentId: string, reactionType: string) => Promise<void>;
}

/**
 * The state a card needs to decide what is enabled — changes only when a
 * mutation starts or finishes, which is exactly when those cards should update.
 */
interface InlineCommentStatusContextValue {
  canComment: boolean;
  canResolveAllComments: boolean;
  currentUserUuid: string | null;
  mutatingCommentIds: ReadonlySet<string>;
}

/**
 * The comment entry points (selection toolbar, read-only trigger) and the
 * compose popup. Kept apart from the full context because the composer is
 * mounted for the whole app shell.
 */
interface InlineCommentComposeContextValue {
  active: boolean;
  pendingComment: PendingInlineComment | null;
  cancelPendingComment: () => void;
  startComment: (editor: YjsEditor, at?: Range) => boolean;
  submitPendingComment: (content: string) => Promise<void>;
}

/**
 * The app shell (layout width, header toggle) only cares whether the panel is
 * open. Keeping it out of the full context stops every comment/anchor/mutation
 * update from re-rendering the sidebar tree and header.
 */
interface InlineCommentPanelContextValue {
  active: boolean;
  isPanelOpen: boolean;
  setPanelOpen: (open: boolean) => void;
}

interface InlineCommentContextValue {
  active: boolean;
  anchors: ReadonlyMap<string, InlineCommentAnchor>;
  canComment: boolean;
  comments: InlineComment[];
  currentUserUuid: string | null;
  filter: InlineCommentFilter;
  focusedCommentId: string | null;
  isPanelOpen: boolean;
  loading: boolean;
  mutatingCommentIds: ReadonlySet<string>;
  pendingComment: PendingInlineComment | null;
  reactions: InlineCommentReaction[];
  cancelPendingComment: () => void;
  createReply: (parentCommentId: string, content: string) => Promise<void>;
  deleteComment: (commentId: string) => Promise<void>;
  focusComment: (commentId: string) => void;
  handleEditorChange: (editor: YjsEditor) => void;
  openCommentFromAnchor: (commentIds: readonly string[]) => void;
  registerEditor: (editor: YjsEditor, options: RegisterInlineCommentEditorOptions) => () => void;
  reload: (showLoading?: boolean) => Promise<InlineComment[]>;
  resolveComment: (commentId: string, isResolved: boolean) => Promise<void>;
  setFilter: (filter: InlineCommentFilter) => void;
  setPanelOpen: (open: boolean) => void;
  startComment: (editor: YjsEditor, at?: Range) => boolean;
  submitPendingComment: (content: string) => Promise<void>;
  toggleReaction: (commentId: string, reactionType: string) => Promise<void>;
  updateEditorAccess: (editor: YjsEditor, options: RegisterInlineCommentEditorOptions) => void;
}

const InlineCommentActionsContext = createContext<InlineCommentActionsContextValue | null>(null);
const InlineCommentComposeContext = createContext<InlineCommentComposeContextValue | null>(null);
const InlineCommentContext = createContext<InlineCommentContextValue | null>(null);
const InlineCommentEditorBridgeContext = createContext<InlineCommentEditorBridgeValue | null>(null);
const InlineCommentLeafContext = createContext<InlineCommentLeafContextValue | null>(null);
const InlineCommentPanelContext = createContext<InlineCommentPanelContextValue | null>(null);
const InlineCommentStatusContext = createContext<InlineCommentStatusContextValue | null>(null);

function getErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }

  return 'The inline comment action failed.';
}

function getMentionedUserUuids(content: string): string[] {
  const mentioned = new Set<string>();
  const mentionPattern = /@\[[^\]\n]+\]\(([^)\s]+)\)/g;
  let match: RegExpExecArray | null;

  while ((match = mentionPattern.exec(content)) !== null) {
    if (uuidValidate(match[1])) mentioned.add(match[1]);
  }

  return Array.from(mentioned);
}

function getSelectionRect(editor: YjsEditor, range: Range): PendingInlineComment['rect'] | null {
  try {
    const rect = ReactEditor.toDOMRange(editor, range).getBoundingClientRect();

    if (rect.top === 0 && rect.left === 0 && rect.width === 0 && rect.height === 0) {
      return null;
    }

    return {
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      left: rect.left,
    };
  } catch {
    return null;
  }
}

function findCreatedComment(
  comments: InlineComment[],
  existingCommentIds: ReadonlySet<string>,
  params: {
    blockId: string | null;
    content: string;
    currentUserUuid?: string;
    replyCommentId: string | null;
  }
): InlineComment | undefined {
  return comments
    .filter(
      (comment) =>
        !existingCommentIds.has(comment.commentId) &&
        !comment.isDeleted &&
        comment.content === params.content &&
        comment.blockId === params.blockId &&
        comment.replyCommentId === params.replyCommentId &&
        (!params.currentUserUuid || !comment.user || comment.user.uuid === params.currentUserUuid)
    )
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))[0];
}

export function InlineCommentProvider({
  children,
  eventEmitter,
  viewId,
  workspaceId,
}: {
  children: React.ReactNode;
  eventEmitter?: EventEmitter;
  viewId?: string;
  workspaceId?: string;
}) {
  const currentUser = useCurrentUserOptional();
  const [active, setActive] = useState(false);
  const [anchors, setAnchors] = useState<Map<string, InlineCommentAnchor>>(() => new Map());
  const [canComment, setCanComment] = useState(false);
  const [canResolveAllComments, setCanResolveAllComments] = useState(false);
  const [comments, setComments] = useState<InlineComment[]>([]);
  const [filter, setFilterState] = useState<InlineCommentFilter>('open');
  const [focusedCommentId, setFocusedCommentIdState] = useState<string | null>(null);
  const [isPanelOpen, setPanelOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mutatingCommentIds, setMutatingCommentIds] = useState<Set<string>>(() => new Set());
  const [pendingComment, setPendingComment] = useState<PendingInlineComment | null>(null);
  const [reactions, setReactions] = useState<InlineCommentReaction[]>([]);

  /**
   * Mirrors of the state above, so the callbacks below can stay referentially
   * stable. Invariant: every `setX` in this file writes `xRef.current` in the
   * same statement group — never mirror them from an effect, which would leave
   * the ref a render behind for anything reading it synchronously.
   */
  const anchorsRef = useRef(anchors);
  const canCommentRef = useRef(canComment);
  const commentsRef = useRef(comments);
  const filterRef = useRef(filter);
  const focusedCommentIdRef = useRef(focusedCommentId);
  const pendingCommentRef = useRef(pendingComment);
  const reactionsRef = useRef(reactions);

  const anchorRetryTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const editorRef = useRef<YjsEditor | null>(null);
  const editorCanWriteRef = useRef(false);
  const editorReadOnlyRef = useRef(false);
  const requestIdRef = useRef(0);

  const setFilter = useCallback((next: InlineCommentFilter) => {
    filterRef.current = next;
    setFilterState(next);
  }, []);

  const setFocusedCommentId = useCallback((next: string | null) => {
    focusedCommentIdRef.current = next;
    setFocusedCommentIdState(next);
  }, []);

  const updateAnchors = useCallback((editor: YjsEditor) => {
    const nextAnchors = collectInlineCommentAnchors(editor);
    const previousAnchors = anchorsRef.current;

    if (!inlineCommentAnchorsEqual(previousAnchors, nextAnchors)) {
      anchorsRef.current = nextAnchors;
      setAnchors(nextAnchors);
    }

    return { nextAnchors, previousAnchors };
  }, []);

  const stopAnchorRefreshRetry = useCallback(() => {
    if (anchorRetryTimerRef.current === null) return;

    clearInterval(anchorRetryTimerRef.current);
    anchorRetryTimerRef.current = null;
  }, []);

  /**
   * The comment list can arrive before the document delta that carries the
   * anchors — a freshly opened page loads its comments over HTTP while the
   * collab document is still syncing. Mirrors the desktop bloc's anchor
   * refresh retry so those threads are not dropped from the panel.
   */
  const scheduleAnchorRefreshRetry = useCallback(
    (nextComments: InlineComment[]) => {
      if (!editorRef.current || hasAnchorsForTopLevelComments(nextComments, anchorsRef.current)) return;

      stopAnchorRefreshRetry();

      let attempts = 0;

      anchorRetryTimerRef.current = setInterval(() => {
        attempts += 1;

        const editor = editorRef.current;

        if (!editor) {
          stopAnchorRefreshRetry();
          return;
        }

        const { nextAnchors } = updateAnchors(editor);

        if (attempts >= ANCHOR_REFRESH_MAX_ATTEMPTS || hasAnchorsForTopLevelComments(commentsRef.current, nextAnchors)) {
          stopAnchorRefreshRetry();
        }
      }, ANCHOR_REFRESH_RETRY_INTERVAL);
    },
    [stopAnchorRefreshRetry, updateAnchors]
  );

  const removeAnchorWithoutDeletingComment = useCallback(
    async (commentId: string) => {
      const editor = editorRef.current;
      const requiresAuthorizedPersistence = !editorCanWriteRef.current;

      if (!editor) return;

      if (!anchorsRef.current.has(commentId)) return;

      const anchorUpdate = removeInlineCommentAnchor(editor, commentId, requiresAuthorizedPersistence);

      if (!requiresAuthorizedPersistence) {
        updateAnchors(editor);
        return;
      }

      if (!anchorUpdate || !workspaceId || !viewId) return;

      await InlineCommentService.applyAnchorUpdate(workspaceId, viewId, {
        commentId,
        update: anchorUpdate,
      });

      applyAuthorizedInlineCommentUpdate(editor, anchorUpdate);
      updateAnchors(editor);
    },
    [updateAnchors, viewId, workspaceId]
  );

  const reload = useCallback(
    async (showLoading = true) => {
      if (!workspaceId || !viewId || !editorRef.current) return [];

      const requestId = ++requestIdRef.current;

      if (showLoading) setLoading(true);

      try {
        const [nextComments, nextReactions] = await Promise.all([
          InlineCommentService.list(workspaceId, viewId),
          InlineCommentService.listReactions(workspaceId, viewId),
        ]);

        if (requestId !== requestIdRef.current) return nextComments;

        commentsRef.current = nextComments;
        setComments(nextComments);
        reactionsRef.current = nextReactions;
        setReactions(nextReactions);

        // A remote delete leaves the Yjs anchor behind. The server retains a
        // tombstone, so remove only ids explicitly reported as deleted.
        await Promise.all(
          nextComments.map((comment) =>
            !comment.replyCommentId && comment.isDeleted
              ? removeAnchorWithoutDeletingComment(comment.commentId)
              : Promise.resolve()
          )
        );

        scheduleAnchorRefreshRetry(nextComments);

        return nextComments;
      } catch (error) {
        if (showLoading) toast.error(getErrorMessage(error));
        throw error;
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
        }
      }
    },
    [removeAnchorWithoutDeletingComment, scheduleAnchorRefreshRetry, viewId, workspaceId]
  );

  const cancelPendingComment = useCallback(() => {
    pendingCommentRef.current?.rangeRef.unref();
    pendingCommentRef.current = null;
    setPendingComment(null);
  }, []);

  const startComment = useCallback(
    (editor: YjsEditor, at?: Range) => {
      if (editor !== editorRef.current || !canCommentRef.current) return false;

      // A read-only editor never receives a Slate selection, so the caller
      // passes the range resolved from the browser selection instead.
      const selection = getInlineCommentSelection(editor, at ?? editor.selection);

      if (!selection) return false;

      const rect = getSelectionRect(editor, selection.range);

      if (!rect) return false;

      cancelPendingComment();

      const nextPending = {
        selection,
        rangeRef: Editor.rangeRef(editor, selection.range, { affinity: 'inward' }),
        rect,
      };

      pendingCommentRef.current = nextPending;
      setPendingComment(nextPending);
      return true;
    },
    [cancelPendingComment]
  );

  const submitPendingComment = useCallback(
    async (content: string) => {
      const trimmedContent = content.trim();
      const editor = editorRef.current;
      const pending = pendingCommentRef.current;

      if (!workspaceId || !viewId || !editor || !pending || !trimmedContent || !canCommentRef.current) return;

      pendingCommentRef.current = null;

      const initialRange = pending.rangeRef.current;
      const initialSelection = initialRange && getInlineCommentSelection(editor, initialRange);

      if (!initialSelection || initialSelection.blockId !== pending.selection.blockId) {
        pending.rangeRef.unref();
        setPendingComment(null);
        toast.error('The selected text is no longer available.');
        return;
      }

      const existingCommentIds = new Set(commentsRef.current.map((comment) => comment.commentId));
      let createdCommentId: string | null = null;
      let rangeRefReleased = false;
      let anchorPersisted = false;
      let requiresAuthorizedPersistence = false;
      let createError: unknown;
      let commentsReloaded = false;

      // Desktop opens the thread panel before the cloud round-trip completes
      // so submission has immediate spatial feedback.
      setPanelOpen(true);
      setMutatingCommentIds((previous) => new Set(previous).add('new'));

      try {
        try {
          createdCommentId = await InlineCommentService.create(workspaceId, viewId, {
            content: trimmedContent,
            blockId: initialSelection.blockId,
            mentionedUserUuids: getMentionedUserUuids(trimmedContent),
          });
        } catch (error) {
          // A transport error does not prove the POST failed. Reconcile the
          // server list before deciding whether the thread needs cleanup.
          createError = error;
        }

        try {
          const nextComments = await reload(false);

          commentsReloaded = true;
          createdCommentId ??=
            findCreatedComment(nextComments, existingCommentIds, {
              blockId: initialSelection.blockId,
              content: trimmedContent,
              currentUserUuid: currentUser?.uuid,
              replyCommentId: null,
            })?.commentId ?? null;
        } catch (error) {
          if (!createdCommentId) throw createError ?? error;
        }

        if (!createdCommentId) throw createError ?? new Error('The newly created inline comment could not be loaded.');

        // Keep the RangeRef registered throughout both network round trips so
        // local and remote edits continue transforming it. Resolve it only at
        // the instant the anchor is written.
        const liveRange = pending.rangeRef.unref();

        rangeRefReleased = true;
        const liveSelection =
          editorRef.current === editor && liveRange ? getInlineCommentSelection(editor, liveRange) : null;

        if (!liveSelection || liveSelection.blockId !== initialSelection.blockId) {
          throw new Error('The selected text is no longer available.');
        }

        requiresAuthorizedPersistence = !editorCanWriteRef.current;
        const anchorUpdate = addInlineCommentAnchor(
          editor,
          liveSelection,
          createdCommentId,
          requiresAuthorizedPersistence
        );

        if (requiresAuthorizedPersistence) {
          if (!anchorUpdate) {
            throw new Error('The inline comment anchor could not be persisted.');
          }

          await InlineCommentService.applyAnchorUpdate(workspaceId, viewId, {
            commentId: createdCommentId,
            update: anchorUpdate,
          });

          if (!applyAuthorizedInlineCommentUpdate(editor, anchorUpdate)) {
            throw new Error('The inline comment anchor could not be applied.');
          }
        }

        anchorPersisted = true;
        if (editorRef.current !== editor) return;

        updateAnchors(editor);

        setPendingComment(null);
        setFilter('open');
        setPanelOpen(true);
        setFocusedCommentId(createdCommentId);

        // If creation returned its id but the list request was transiently
        // unavailable, refresh opportunistically so the visible anchor gains
        // its sidebar card without requiring a page reload.
        if (!commentsReloaded) void reload(false).catch(() => undefined);
      } catch (error) {
        if (createdCommentId && !anchorPersisted) {
          // The cloud thread must never outlive a failed anchor write. Also
          // undo local formatting from the normal write lane. Authorized
          // updates are isolated and do not touch the live Y.Doc until the
          // server accepts them, so they need no rollback transaction.
          if (!requiresAuthorizedPersistence) removeInlineCommentAnchor(editor, createdCommentId);
          await InlineCommentService.remove(workspaceId, viewId, createdCommentId).catch(() => undefined);
          updateAnchors(editor);
        }

        setPendingComment(null);
        toast.error(getErrorMessage(error));
      } finally {
        if (!rangeRefReleased) pending.rangeRef.unref();
        setMutatingCommentIds((previous) => {
          const next = new Set(previous);

          next.delete('new');
          return next;
        });
      }
    },
    [currentUser?.uuid, reload, setFilter, setFocusedCommentId, updateAnchors, viewId, workspaceId]
  );

  const runCommentMutation = useCallback(
    async (commentId: string, mutation: () => Promise<void>) => {
      setMutatingCommentIds((previous) => new Set(previous).add(commentId));
      try {
        await mutation();
        await reload(false);
      } catch (error) {
        toast.error(getErrorMessage(error));
        throw error;
      } finally {
        setMutatingCommentIds((previous) => {
          const next = new Set(previous);

          next.delete(commentId);
          return next;
        });
      }
    },
    [reload]
  );

  const resolveComment = useCallback(
    async (commentId: string, isResolved: boolean) => {
      if (!workspaceId || !viewId || !canCommentRef.current) return;

      const comment = commentsRef.current.find((item) => item.commentId === commentId);
      const canResolve =
        comment &&
        !comment.replyCommentId &&
        ((Boolean(currentUser?.uuid) && comment.user?.uuid === currentUser?.uuid) ||
          comment.canBeDeleted ||
          editorCanWriteRef.current);

      if (!canResolve) return;

      await runCommentMutation(commentId, () =>
        InlineCommentService.resolve(workspaceId, viewId, commentId, isResolved)
      );

      if (isResolved && filterRef.current === 'open') {
        setFocusedCommentId(null);
      }
    },
    [currentUser?.uuid, runCommentMutation, setFocusedCommentId, viewId, workspaceId]
  );

  const deleteComment = useCallback(
    async (commentId: string) => {
      if (!workspaceId || !viewId || !canCommentRef.current) return;

      const comment = commentsRef.current.find((item) => item.commentId === commentId);

      await runCommentMutation(commentId, () => InlineCommentService.remove(workspaceId, viewId, commentId));

      if (comment && !comment.replyCommentId) {
        await removeAnchorWithoutDeletingComment(commentId);
      }

      if (focusedCommentIdRef.current === commentId) setFocusedCommentId(null);
    },
    [removeAnchorWithoutDeletingComment, runCommentMutation, setFocusedCommentId, viewId, workspaceId]
  );

  const createReply = useCallback(
    async (parentCommentId: string, content: string) => {
      const trimmedContent = content.trim();

      if (!workspaceId || !viewId || !trimmedContent || !canCommentRef.current) return;

      const parent = commentsRef.current.find((comment) => comment.commentId === parentCommentId);

      if (!parent) return;

      await runCommentMutation(parentCommentId, async () => {
        await InlineCommentService.create(workspaceId, viewId, {
          content: trimmedContent,
          blockId: parent.blockId ?? undefined,
          replyCommentId: parentCommentId,
          mentionedUserUuids: getMentionedUserUuids(trimmedContent),
        });
      });
    },
    [runCommentMutation, viewId, workspaceId]
  );

  const toggleReaction = useCallback(
    async (commentId: string, reactionType: string) => {
      const userUuid = currentUser?.uuid;

      if (!workspaceId || !viewId || !userUuid || !reactionType || !canCommentRef.current) return;

      const reaction = reactionsRef.current.find(
        (item) => item.commentId === commentId && item.reactionType === reactionType
      );
      const hasReacted = reaction?.reactUsers.some((user) => user.uuid === userUuid) ?? false;

      await runCommentMutation(commentId, () =>
        hasReacted
          ? InlineCommentService.removeReaction(workspaceId, viewId, commentId, reactionType)
          : InlineCommentService.createReaction(workspaceId, viewId, commentId, reactionType)
      );
    },
    [currentUser?.uuid, runCommentMutation, viewId, workspaceId]
  );

  const focusComment = useCallback(
    (commentId: string) => {
      const comment = commentsRef.current.find((item) => item.commentId === commentId);
      const anchor = anchorsRef.current.get(commentId);
      const editor = editorRef.current;

      if (!comment || !anchor || !editor) return;

      setFocusedCommentId(commentId);
      setFilter(comment.isResolved ? 'resolved' : 'open');
      setPanelOpen(true);

      try {
        Transforms.select(editor, anchor.range);
        if (!editorReadOnlyRef.current) ReactEditor.focus(editor);
        ReactEditor.toDOMRange(editor, anchor.range).startContainer.parentElement?.scrollIntoView({
          behavior: 'smooth',
          block: 'center',
        });
      } catch {
        // The anchor can move between a remote update and this click. The next
        // Slate change will rebuild it; keeping the card focused is still useful.
      }

      requestAnimationFrame(() => {
        document.getElementById(`inline-comment-${commentId}`)?.scrollIntoView({ block: 'nearest' });
      });
    },
    [setFilter, setFocusedCommentId]
  );

  const openCommentFromAnchor = useCallback(
    (commentIds: readonly string[]) => {
      const candidates = commentIds
        .map((id) => commentsRef.current.find((comment) => comment.commentId === id))
        .filter((comment): comment is InlineComment =>
          Boolean(comment && !comment.replyCommentId && !comment.isDeleted && anchorsRef.current.has(comment.commentId))
        )
        .sort((left, right) => {
          if (left.isResolved !== right.isResolved) return left.isResolved ? 1 : -1;

          const leftLength = anchorsRef.current.get(left.commentId)?.quotedText.length ?? Number.MAX_SAFE_INTEGER;
          const rightLength = anchorsRef.current.get(right.commentId)?.quotedText.length ?? Number.MAX_SAFE_INTEGER;

          return leftLength - rightLength;
        });

      if (candidates[0]) focusComment(candidates[0].commentId);
    },
    [focusComment]
  );

  const handleEditorChange = useCallback(
    (editor: YjsEditor) => {
      if (editor !== editorRef.current) return;
      if (!operationsCanAffectAnchors(editor.operations, anchorsRef.current.size > 0)) return;

      // Text deletion is part of Slate's undo history while cloud comment
      // deletion is irreversible. Keep the thread tombstone-free here: undo
      // can then restore the text and its metadata without producing a ghost
      // anchor. Explicit comment deletion still removes both sides together.
      updateAnchors(editor);
    },
    [updateAnchors]
  );

  /**
   * A document whose content arrives after connect (row documents, a version
   * reset) replaces `editor.children` wholesale instead of applying Slate
   * operations, so no change event reaches [handleEditorChange]. Rescan the
   * anchors without the change handler's delete-orphaned-comment side effect.
   */
  const refreshAnchors = useCallback(
    (editor: YjsEditor) => {
      if (editor !== editorRef.current) return;

      updateAnchors(editor);
    },
    [updateAnchors]
  );

  const registerEditor = useCallback(
    (editor: YjsEditor, options: RegisterInlineCommentEditorOptions) => {
      if (options.viewId !== viewId) return () => undefined;

      editorRef.current = editor;
      editorCanWriteRef.current = options.canWrite;
      editorReadOnlyRef.current = options.readOnly;
      canCommentRef.current = options.canComment;
      setCanComment(options.canComment);
      setCanResolveAllComments(options.canWrite);
      setActive(true);
      updateAnchors(editor);

      return () => {
        if (editorRef.current !== editor) return;

        cancelPendingComment();
        stopAnchorRefreshRetry();
        requestIdRef.current += 1;
        editorRef.current = null;
        editorCanWriteRef.current = false;
        editorReadOnlyRef.current = false;
        canCommentRef.current = false;
        setCanComment(false);
        setCanResolveAllComments(false);
        setLoading(false);
        setMutatingCommentIds(new Set());
        commentsRef.current = [];
        setComments([]);
        reactionsRef.current = [];
        setReactions([]);
        anchorsRef.current = new Map();
        setAnchors(new Map());
        setActive(false);
        setPanelOpen(false);
        setFocusedCommentId(null);
      };
    },
    [cancelPendingComment, setFocusedCommentId, stopAnchorRefreshRetry, updateAnchors, viewId]
  );

  const updateEditorAccess = useCallback(
    (editor: YjsEditor, options: RegisterInlineCommentEditorOptions) => {
      if (editor !== editorRef.current || options.viewId !== viewId) return;

      editorCanWriteRef.current = options.canWrite;
      editorReadOnlyRef.current = options.readOnly;
      canCommentRef.current = options.canComment;
      setCanComment(options.canComment);
      setCanResolveAllComments(options.canWrite);

      if (!options.canComment) cancelPendingComment();
    },
    [cancelPendingComment, viewId]
  );

  useEffect(() => {
    if (!active) return;

    void reload().catch(() => undefined);
  }, [active, reload]);

  useEffect(() => {
    if (!active || !eventEmitter) return;

    const handleCommentChanged = (payload: {
      viewId?: string;
      view_id?: string;
      workspaceId?: string;
      workspace_id?: string;
    }) => {
      const changedViewId = payload.viewId ?? payload.view_id;
      const changedWorkspaceId = payload.workspaceId ?? payload.workspace_id;

      if (changedViewId === viewId && changedWorkspaceId === workspaceId) {
        void reload(false).catch(() => undefined);
      }
    };

    eventEmitter.on(APP_EVENTS.INLINE_COMMENT_CHANGED, handleCommentChanged);
    return () => {
      eventEmitter.off(APP_EVENTS.INLINE_COMMENT_CHANGED, handleCommentChanged);
    };
  }, [active, eventEmitter, reload, viewId, workspaceId]);

  useEffect(() => {
    return () => {
      requestIdRef.current += 1;
      stopAnchorRefreshRetry();
      pendingCommentRef.current?.rangeRef.unref();
    };
  }, [stopAnchorRefreshRetry]);

  const value = useMemo<InlineCommentContextValue>(
    () => ({
      active,
      anchors,
      canComment,
      comments,
      currentUserUuid: currentUser?.uuid ?? null,
      filter,
      focusedCommentId,
      isPanelOpen,
      loading,
      mutatingCommentIds,
      pendingComment,
      reactions,
      cancelPendingComment,
      createReply,
      deleteComment,
      focusComment,
      handleEditorChange,
      openCommentFromAnchor,
      registerEditor,
      reload,
      resolveComment,
      setFilter,
      setPanelOpen,
      startComment,
      submitPendingComment,
      toggleReaction,
      updateEditorAccess,
    }),
    [
      active,
      anchors,
      canComment,
      cancelPendingComment,
      comments,
      createReply,
      currentUser?.uuid,
      deleteComment,
      filter,
      focusComment,
      focusedCommentId,
      handleEditorChange,
      isPanelOpen,
      loading,
      mutatingCommentIds,
      openCommentFromAnchor,
      pendingComment,
      reactions,
      registerEditor,
      reload,
      resolveComment,
      setFilter,
      startComment,
      submitPendingComment,
      toggleReaction,
      updateEditorAccess,
    ]
  );

  const editorBridgeValue = useMemo<InlineCommentEditorBridgeValue>(
    () => ({
      handleEditorChange,
      refreshAnchors,
      registerEditor,
      updateEditorAccess,
    }),
    [handleEditorChange, refreshAnchors, registerEditor, updateEditorAccess]
  );

  const leafContextValue = useMemo<InlineCommentLeafContextValue>(
    () => ({
      active,
      focusedCommentId,
      openCommentFromAnchor,
    }),
    [active, focusedCommentId, openCommentFromAnchor]
  );

  const panelContextValue = useMemo<InlineCommentPanelContextValue>(
    () => ({
      active,
      isPanelOpen,
      setPanelOpen,
    }),
    [active, isPanelOpen]
  );

  const actionsContextValue = useMemo<InlineCommentActionsContextValue>(
    () => ({
      createReply,
      deleteComment,
      focusComment,
      resolveComment,
      toggleReaction,
    }),
    [createReply, deleteComment, focusComment, resolveComment, toggleReaction]
  );

  const statusContextValue = useMemo<InlineCommentStatusContextValue>(
    () => ({
      canComment,
      canResolveAllComments,
      currentUserUuid: currentUser?.uuid ?? null,
      mutatingCommentIds,
    }),
    [canComment, canResolveAllComments, currentUser?.uuid, mutatingCommentIds]
  );

  const composeContextValue = useMemo<InlineCommentComposeContextValue>(
    () => ({
      active,
      cancelPendingComment,
      pendingComment,
      startComment,
      submitPendingComment,
    }),
    [active, cancelPendingComment, pendingComment, startComment, submitPendingComment]
  );

  return (
    <InlineCommentEditorBridgeContext.Provider value={editorBridgeValue}>
      <InlineCommentPanelContext.Provider value={panelContextValue}>
        <InlineCommentActionsContext.Provider value={actionsContextValue}>
          <InlineCommentStatusContext.Provider value={statusContextValue}>
            <InlineCommentComposeContext.Provider value={composeContextValue}>
              <InlineCommentLeafContext.Provider value={leafContextValue}>
                <InlineCommentContext.Provider value={value}>{children}</InlineCommentContext.Provider>
              </InlineCommentLeafContext.Provider>
            </InlineCommentComposeContext.Provider>
          </InlineCommentStatusContext.Provider>
        </InlineCommentActionsContext.Provider>
      </InlineCommentPanelContext.Provider>
    </InlineCommentEditorBridgeContext.Provider>
  );
}

export function useInlineCommentActions(): InlineCommentActionsContextValue {
  const context = useContext(InlineCommentActionsContext);

  if (!context) {
    throw new Error('useInlineCommentActions must be used within InlineCommentProvider');
  }

  return context;
}

export function useInlineCommentStatus(): InlineCommentStatusContextValue {
  const context = useContext(InlineCommentStatusContext);

  if (!context) {
    throw new Error('useInlineCommentStatus must be used within InlineCommentProvider');
  }

  return context;
}

export function useInlineCommentCompose(): InlineCommentComposeContextValue {
  const context = useContext(InlineCommentComposeContext);

  if (!context) {
    throw new Error('useInlineCommentCompose must be used within InlineCommentProvider');
  }

  return context;
}

export function useInlineCommentComposeOptional(): InlineCommentComposeContextValue | null {
  return useContext(InlineCommentComposeContext);
}

export function useInlineCommentContext(): InlineCommentContextValue {
  const context = useContext(InlineCommentContext);

  if (!context) {
    throw new Error('useInlineCommentContext must be used within InlineCommentProvider');
  }

  return context;
}

export function useInlineCommentContextOptional(): InlineCommentContextValue | null {
  return useContext(InlineCommentContext);
}

export function useInlineCommentEditorBridgeOptional(): InlineCommentEditorBridgeValue | null {
  return useContext(InlineCommentEditorBridgeContext);
}

export function useInlineCommentLeafContextOptional(): InlineCommentLeafContextValue | null {
  return useContext(InlineCommentLeafContext);
}

export function useInlineCommentPanel(): InlineCommentPanelContextValue {
  const context = useContext(InlineCommentPanelContext);

  if (!context) {
    throw new Error('useInlineCommentPanel must be used within InlineCommentProvider');
  }

  return context;
}

export function useInlineCommentPanelOptional(): InlineCommentPanelContextValue | null {
  return useContext(InlineCommentPanelContext);
}

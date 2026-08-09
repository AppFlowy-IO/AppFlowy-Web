import type EventEmitter from 'events';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Editor, Range, RangeRef, Transforms } from 'slate';
import { ReactEditor } from 'slate-react';
import { validate as uuidValidate } from 'uuid';

import { APP_EVENTS } from '@/application/constants';
import { InlineComment, InlineCommentReaction } from '@/application/inline-comment';
import { InlineCommentService } from '@/application/services/domains';
import { YjsEditor } from '@/application/slate-yjs';
import { useCurrentUserOptional } from '@/components/main/app.hooks';

import {
  addInlineCommentAnchor,
  collectInlineCommentAnchors,
  getInlineCommentSelection,
  InlineCommentAnchor,
  InlineCommentSelection,
  inlineCommentAnchorsEqual,
  removeInlineCommentAnchor,
} from './editor/anchors';

export const INLINE_COMMENT_DRAWER_WIDTH = 352;

export type InlineCommentFilter = 'open' | 'resolved' | 'all';

interface PendingInlineComment {
  selection: InlineCommentSelection;
  rangeRef: RangeRef;
  rect: Pick<DOMRect, 'bottom' | 'left' | 'right' | 'top'>;
}

interface RegisterInlineCommentEditorOptions {
  canComment: boolean;
  readOnly: boolean;
  viewId: string;
}

interface InlineCommentEditorBridgeValue {
  handleEditorChange: (editor: YjsEditor) => void;
  registerEditor: (editor: YjsEditor, options: RegisterInlineCommentEditorOptions) => () => void;
  updateEditorAccess: (editor: YjsEditor, options: RegisterInlineCommentEditorOptions) => void;
}

interface InlineCommentLeafContextValue {
  active: boolean;
  focusedCommentId: string | null;
  openCommentFromAnchor: (commentIds: string[]) => void;
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
  openCommentFromAnchor: (commentIds: string[]) => void;
  registerEditor: (editor: YjsEditor, options: RegisterInlineCommentEditorOptions) => () => void;
  reload: (showLoading?: boolean) => Promise<InlineComment[]>;
  resolveComment: (commentId: string, isResolved: boolean) => Promise<void>;
  setFilter: (filter: InlineCommentFilter) => void;
  setPanelOpen: (open: boolean) => void;
  startComment: (editor: YjsEditor) => boolean;
  submitPendingComment: (content: string) => Promise<void>;
  toggleReaction: (commentId: string, reactionType: string) => Promise<void>;
  updateEditorAccess: (editor: YjsEditor, options: RegisterInlineCommentEditorOptions) => void;
}

const InlineCommentContext = createContext<InlineCommentContextValue | null>(null);
const InlineCommentEditorBridgeContext = createContext<InlineCommentEditorBridgeValue | null>(null);
const InlineCommentLeafContext = createContext<InlineCommentLeafContextValue | null>(null);

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
  const [comments, setComments] = useState<InlineComment[]>([]);
  const [filter, setFilter] = useState<InlineCommentFilter>('open');
  const [focusedCommentId, setFocusedCommentId] = useState<string | null>(null);
  const [isPanelOpen, setPanelOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [mutatingCommentIds, setMutatingCommentIds] = useState<Set<string>>(() => new Set());
  const [pendingComment, setPendingComment] = useState<PendingInlineComment | null>(null);
  const [reactions, setReactions] = useState<InlineCommentReaction[]>([]);

  const anchorsRef = useRef(anchors);
  const canCommentRef = useRef(canComment);
  const commentsRef = useRef(comments);
  const editorRef = useRef<YjsEditor | null>(null);
  const editorReadOnlyRef = useRef(false);
  const pendingCommentRef = useRef(pendingComment);
  const reactionsRef = useRef(reactions);
  const requestIdRef = useRef(0);
  const suppressedAnchorDeletionsRef = useRef(new Set<string>());

  useEffect(() => {
    anchorsRef.current = anchors;
  }, [anchors]);

  useEffect(() => {
    commentsRef.current = comments;
  }, [comments]);

  useEffect(() => {
    canCommentRef.current = canComment;
  }, [canComment]);

  useEffect(() => {
    pendingCommentRef.current = pendingComment;
  }, [pendingComment]);

  useEffect(() => {
    reactionsRef.current = reactions;
  }, [reactions]);

  const updateAnchors = useCallback((editor: YjsEditor) => {
    const nextAnchors = collectInlineCommentAnchors(editor);
    const previousAnchors = anchorsRef.current;

    if (!inlineCommentAnchorsEqual(previousAnchors, nextAnchors)) {
      anchorsRef.current = nextAnchors;
      setAnchors(nextAnchors);
    }

    return { nextAnchors, previousAnchors };
  }, []);

  const removeAnchorWithoutDeletingComment = useCallback(
    (commentId: string) => {
      const editor = editorRef.current;

      if (!editor || !anchorsRef.current.has(commentId)) return;

      suppressedAnchorDeletionsRef.current.add(commentId);
      try {
        removeInlineCommentAnchor(editor, commentId);
        updateAnchors(editor);
      } finally {
        suppressedAnchorDeletionsRef.current.delete(commentId);
      }
    },
    [updateAnchors]
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
        for (const comment of nextComments) {
          if (!comment.replyCommentId && comment.isDeleted) {
            removeAnchorWithoutDeletingComment(comment.commentId);
          }
        }

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
    [removeAnchorWithoutDeletingComment, viewId, workspaceId]
  );

  const cancelPendingComment = useCallback(() => {
    pendingCommentRef.current?.rangeRef.unref();
    pendingCommentRef.current = null;
    setPendingComment(null);
  }, []);

  const startComment = useCallback(
    (editor: YjsEditor) => {
      if (editor !== editorRef.current || !canCommentRef.current) return false;

      const selection = getInlineCommentSelection(editor);

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

      const range = pending.rangeRef.unref();

      pendingCommentRef.current = null;

      if (!range) {
        setPendingComment(null);
        toast.error('The selected text is no longer available.');
        return;
      }

      const liveSelection = getInlineCommentSelection(editor, range);

      if (!liveSelection || liveSelection.blockId !== pending.selection.blockId) {
        setPendingComment(null);
        toast.error('The selected text is no longer available.');
        return;
      }

      const existingCommentIds = new Set(commentsRef.current.map((comment) => comment.commentId));

      // Desktop opens the thread panel before the cloud round-trip completes
      // so submission has immediate spatial feedback.
      setPanelOpen(true);
      setMutatingCommentIds((previous) => new Set(previous).add('new'));

      try {
        await InlineCommentService.create(workspaceId, viewId, {
          content: trimmedContent,
          blockId: liveSelection.blockId,
          mentionedUserUuids: getMentionedUserUuids(trimmedContent),
        });

        const nextComments = await reload(false);
        const createdComment = findCreatedComment(nextComments, existingCommentIds, {
          blockId: liveSelection.blockId,
          content: trimmedContent,
          currentUserUuid: currentUser?.uuid,
          replyCommentId: null,
        });

        if (!createdComment) {
          throw new Error('The newly created inline comment could not be loaded.');
        }

        try {
          addInlineCommentAnchor(editor, liveSelection, createdComment.commentId);
          updateAnchors(editor);
        } catch (error) {
          // The cloud comment must not outlive a failed local anchor write.
          await InlineCommentService.remove(workspaceId, viewId, createdComment.commentId);
          throw error;
        }

        setPendingComment(null);
        setFilter('open');
        setPanelOpen(true);
        setFocusedCommentId(createdComment.commentId);
      } catch (error) {
        setPendingComment(null);
        toast.error(getErrorMessage(error));
      } finally {
        setMutatingCommentIds((previous) => {
          const next = new Set(previous);

          next.delete('new');
          return next;
        });
      }
    },
    [currentUser?.uuid, reload, updateAnchors, viewId, workspaceId]
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

      await runCommentMutation(commentId, () =>
        InlineCommentService.resolve(workspaceId, viewId, commentId, isResolved)
      );

      if (isResolved && filter === 'open') {
        setFocusedCommentId(null);
      }
    },
    [filter, runCommentMutation, viewId, workspaceId]
  );

  const deleteComment = useCallback(
    async (commentId: string) => {
      if (!workspaceId || !viewId || !canCommentRef.current) return;

      const comment = commentsRef.current.find((item) => item.commentId === commentId);

      await runCommentMutation(commentId, () => InlineCommentService.remove(workspaceId, viewId, commentId));

      if (comment && !comment.replyCommentId) {
        removeAnchorWithoutDeletingComment(commentId);
      }

      if (focusedCommentId === commentId) setFocusedCommentId(null);
    },
    [focusedCommentId, removeAnchorWithoutDeletingComment, runCommentMutation, viewId, workspaceId]
  );

  const createReply = useCallback(
    async (parentCommentId: string, content: string) => {
      const trimmedContent = content.trim();

      if (!workspaceId || !viewId || !trimmedContent || !canCommentRef.current) return;

      const parent = commentsRef.current.find((comment) => comment.commentId === parentCommentId);

      if (!parent) return;

      await runCommentMutation(parentCommentId, () =>
        InlineCommentService.create(workspaceId, viewId, {
          content: trimmedContent,
          blockId: parent.blockId ?? undefined,
          replyCommentId: parentCommentId,
          mentionedUserUuids: getMentionedUserUuids(trimmedContent),
        })
      );
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

  const focusComment = useCallback((commentId: string) => {
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
  }, []);

  const openCommentFromAnchor = useCallback(
    (commentIds: string[]) => {
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

      const { nextAnchors, previousAnchors } = updateAnchors(editor);

      if (!canCommentRef.current) return;

      for (const commentId of previousAnchors.keys()) {
        if (nextAnchors.has(commentId) || suppressedAnchorDeletionsRef.current.has(commentId)) continue;

        const comment = commentsRef.current.find(
          (item) => item.commentId === commentId && !item.replyCommentId && !item.isDeleted
        );

        if (!comment || !workspaceId || !viewId) continue;

        // Deleting the last selected character removes the anchor. Match the
        // desktop service by deleting the corresponding cloud thread as well.
        void runCommentMutation(commentId, () => InlineCommentService.remove(workspaceId, viewId, commentId)).catch(
          () => undefined
        );
      }
    },
    [runCommentMutation, updateAnchors, viewId, workspaceId]
  );

  const registerEditor = useCallback(
    (editor: YjsEditor, options: RegisterInlineCommentEditorOptions) => {
      if (options.viewId !== viewId) return () => undefined;

      editorRef.current = editor;
      editorReadOnlyRef.current = options.readOnly;
      canCommentRef.current = options.canComment;
      setCanComment(options.canComment);
      setActive(true);
      updateAnchors(editor);

      return () => {
        if (editorRef.current !== editor) return;

        cancelPendingComment();
        requestIdRef.current += 1;
        editorRef.current = null;
        editorReadOnlyRef.current = false;
        canCommentRef.current = false;
        setCanComment(false);
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
    [cancelPendingComment, updateAnchors, viewId]
  );

  const updateEditorAccess = useCallback(
    (editor: YjsEditor, options: RegisterInlineCommentEditorOptions) => {
      if (editor !== editorRef.current || options.viewId !== viewId) return;

      editorReadOnlyRef.current = options.readOnly;
      canCommentRef.current = options.canComment;
      setCanComment(options.canComment);

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
      pendingCommentRef.current?.rangeRef.unref();
    };
  }, []);

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
      startComment,
      submitPendingComment,
      toggleReaction,
      updateEditorAccess,
    ]
  );

  const editorBridgeValue = useMemo<InlineCommentEditorBridgeValue>(
    () => ({
      handleEditorChange,
      registerEditor,
      updateEditorAccess,
    }),
    [handleEditorChange, registerEditor, updateEditorAccess]
  );

  const leafContextValue = useMemo<InlineCommentLeafContextValue>(
    () => ({
      active,
      focusedCommentId,
      openCommentFromAnchor,
    }),
    [active, focusedCommentId, openCommentFromAnchor]
  );

  return (
    <InlineCommentEditorBridgeContext.Provider value={editorBridgeValue}>
      <InlineCommentLeafContext.Provider value={leafContextValue}>
        <InlineCommentContext.Provider value={value}>{children}</InlineCommentContext.Provider>
      </InlineCommentLeafContext.Provider>
    </InlineCommentEditorBridgeContext.Provider>
  );
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

import dayjs from 'dayjs';
import React, { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { GlobalComment, Reaction } from '@/application/comment.type';
import { PublishContext } from '@/application/publish';
import { PublishService } from '@/application/services/domains';
import { AFWebUser } from '@/application/types';
import { getUserIconUrl } from '@/application/user-metadata';
import { useCurrentUserWorkspaceAvatar } from '@/components/app/useWorkspaceMemberProfile';
import { useCurrentUserOptional } from '@/components/main/app.hooks';
import { stringAvatar } from '@/utils/color';
import { isFlagEmoji } from '@/utils/emoji';

type GlobalCommentContextType = {
  reload: () => Promise<void>;
  getComment: (commentId: string) => GlobalComment | undefined;
  loading: boolean;
  comments: GlobalComment[] | null;
  replyComment: (commentId: string | null) => void;
  replyCommentId: string | null;
  reactions: Record<string, Reaction[]> | null;
  toggleReaction: (commentId: string, reactionType: string) => void;
  setHighLightCommentId: (commentId: string | null) => void;
  highLightCommentId: string | null;
};

export const GlobalCommentContext = React.createContext<GlobalCommentContextType | undefined>(undefined);

export function useGlobalCommentContext() {
  const context = useContext(GlobalCommentContext);

  if (!context) {
    throw new Error('useGlobalCommentContext must be used within a GlobalCommentProvider');
  }

  return context;
}

type ReactionSnapshot = Record<string, Reaction[]> | null;
type ReactionIntent = { commentId: string; reactionType: string; user: AFWebUser; added: boolean };
type ReactionQueue = { confirmed: boolean; pending: number; tail: Promise<void> };

/** Apply an explicit membership; React never decides which request an event sends. */
function applyReactionIntent(previous: ReactionSnapshot, intent: ReactionIntent): Record<string, Reaction[]> {
  const { commentId, reactionType, user, added } = intent;
  const reactions = previous?.[commentId] ?? [];
  const existing = reactions.find((reaction) => reaction.reactionType === reactionType);
  const otherUsers = existing?.reactUsers.filter((item) => item.uuid !== user.uuid) ?? [];
  const next = { commentId, reactionType, reactUsers: added ? [...otherUsers, user] : otherUsers };

  return {
    ...previous,
    [commentId]: existing
      ? reactions.map((reaction) => (reaction === existing ? next : reaction))
      : [...reactions, next],
  };
}

export function useLoadReactions() {
  const viewId = useContext(PublishContext)?.viewMeta?.view_id;
  const currentUser = useCurrentUserOptional();
  const workspaceAvatar = useCurrentUserWorkspaceAvatar();
  const currentUserAvatar = useMemo(() => getUserIconUrl(currentUser, workspaceAvatar), [currentUser, workspaceAvatar]);
  const userUuid = currentUser?.uuid;
  // The synchronous snapshot preserves rapid clicks before React commits. Each
  // page/user session owns its requests so an old completion cannot change it.
  const session = useMemo(
    () => ({
      viewId,
      userUuid,
      active: false,
      loading: true,
      reactions: null as ReactionSnapshot,
      changes: new Map<string, ReactionIntent>(),
      queues: new Map<string, ReactionQueue>(),
      load: Promise.resolve(),
    }),
    [viewId, userUuid]
  );
  const [state, setState] = useState<{ session: typeof session; reactions: ReactionSnapshot }>({
    session,
    reactions: null,
  });
  const publishIntent = useCallback(
    (key: string, intent: ReactionIntent) => {
      if (session.loading) session.changes.set(key, intent);
      session.reactions = applyReactionIntent(session.reactions, intent);
      setState({ session, reactions: session.reactions });
    },
    [session]
  );

  useEffect(() => {
    let current = true;

    session.active = true;
    session.load = (async () => {
      if (!session.viewId) return;
      try {
        let reactions = await PublishService.getReactions(session.viewId);

        if (!current) return;
        // Requests wait for this baseline, while the UI can already reflect
        // clicks. Rebase their rollback value without erasing optimistic intent.
        for (const [key, intent] of session.changes) {
          const queue = session.queues.get(key);

          if (queue)
            queue.confirmed =
              reactions[intent.commentId]?.some(
                (reaction) =>
                  reaction.reactionType === intent.reactionType &&
                  reaction.reactUsers.some((user) => user.uuid === intent.user.uuid)
              ) ?? false;
          reactions = applyReactionIntent(reactions, intent);
        }

        session.reactions = reactions;
        setState({ session, reactions });
      } catch (error) {
        if (current) console.error(error);
      } finally {
        if (current) {
          session.loading = false;
          session.changes.clear();
        }
      }
    })();
    return () => {
      current = false;
      session.active = false;
    };
  }, [session]);

  const toggleReaction = useCallback(
    async (commentId: string, reactionType: string) => {
      if (!viewId || !currentUser?.uuid || !reactionType || !session.active) return;
      const key = JSON.stringify([commentId, reactionType]);
      const hasReacted =
        session.reactions?.[commentId]?.some(
          (reaction) =>
            reaction.reactionType === reactionType && reaction.reactUsers.some((user) => user.uuid === currentUser.uuid)
        ) ?? false;
      const intent: ReactionIntent = {
        commentId,
        reactionType,
        user: { uuid: currentUser.uuid, name: currentUser.name || '', avatarUrl: currentUserAvatar || null },
        added: !hasReacted,
      };
      const queue = session.queues.get(key) ?? { confirmed: hasReacted, pending: 0, tail: Promise.resolve() };

      session.queues.set(key, queue);
      queue.pending += 1;
      publishIntent(key, intent);
      // Serialize only this reaction: a slow add must settle before its remove.
      queue.tail = queue.tail.then(async () => {
        await session.load;
        if (!session.active) return;
        try {
          if (intent.added) {
            await PublishService.addReaction(viewId, commentId, reactionType);
          } else {
            await PublishService.removeReaction(viewId, commentId, reactionType);
          }

          queue.confirmed = intent.added;
        } catch (error) {
          console.error(error);
        } finally {
          queue.pending -= 1;
          if (queue.pending === 0) {
            session.queues.delete(key);
            if (session.active) publishIntent(key, { ...intent, added: queue.confirmed });
          }
        }
      });
      return queue.tail;
    },
    [currentUser, currentUserAvatar, publishIntent, session, viewId]
  );

  return { reactions: state.session === session ? state.reactions : null, toggleReaction };
}

export function useLoadComments() {
  const viewId = useContext(PublishContext)?.viewMeta?.view_id;

  const [comments, setComments] = useState<GlobalComment[] | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchComments = useCallback(async () => {
    if (!viewId) return;

    setLoading(true);
    try {
      const comments = await PublishService.getComments(viewId);

      setComments(comments);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, [viewId]);

  useEffect(() => {
    void fetchComments();
  }, [fetchComments]);

  return { comments, loading, reload: fetchComments };
}

export function getAvatar(comment: GlobalComment) {
  if (comment.user?.avatarUrl) {
    const isFlag = isFlagEmoji(comment.user.avatarUrl);

    return {
      children: <span className={isFlag ? 'icon' : ''}>{comment.user.avatarUrl}</span>,
      sx: {
        bgcolor: 'transparent',
        color: 'var(--text-primary)',
      },
    };
  }

  return stringAvatar(comment.user?.name || '');
}

export function useCommentRender(comment: GlobalComment) {
  const { t } = useTranslation();
  const avatar = useMemo(() => {
    return getAvatar(comment);
  }, [comment]);

  const timeFormat = useMemo(() => {
    const time = dayjs(comment.lastUpdatedAt);

    return time.format('YYYY-MM-DD HH:mm:ss');
  }, [comment.lastUpdatedAt]);

  const time = useMemo(() => {
    if (!comment.lastUpdatedAt) return '';
    const now = dayjs();
    const past = dayjs(comment.lastUpdatedAt);
    const diffSec = now.diff(past, 'second');
    const diffMin = now.diff(past, 'minute');
    const diffHour = now.diff(past, 'hour');
    const diffDay = now.diff(past, 'day');
    const diffMonth = now.diff(past, 'month');
    const diffYear = now.diff(past, 'year');

    if (diffSec < 5) {
      return t('globalComment.showSeconds', {
        count: 0,
      });
    }

    if (diffMin < 1) {
      return t('globalComment.showSeconds', {
        count: diffSec,
      });
    }

    if (diffHour < 1) {
      return t('globalComment.showMinutes', {
        count: diffMin,
      });
    }

    if (diffDay < 1) {
      return t('globalComment.showHours', {
        count: diffHour,
      });
    }

    if (diffMonth < 1) {
      return t('globalComment.showDays', {
        count: diffDay,
      });
    }

    if (diffYear < 1) {
      return t('globalComment.showMonths', {
        count: diffMonth,
      });
    }

    return t('globalComment.showYears', {
      count: diffYear,
    });
  }, [t, comment]);

  return { avatar, time, timeFormat };
}

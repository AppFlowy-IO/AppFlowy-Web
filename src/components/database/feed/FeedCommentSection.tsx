import dayjs from 'dayjs';
import { memo, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useRowMap } from '@/application/database-yjs';
import { useAddCommentDispatch } from '@/application/database-yjs/comment_dispatch';
import { getCommentsMap, getRowComments } from '@/application/database-yjs/row_comment';
import { RowComment } from '@/application/row-comment.type';
import { YjsEditorKey } from '@/application/types';
import { CommentComposer } from '@/components/database/components/database-row/comment/CommentComposer';

import { formatFeedRelativeTime } from './feed.utils';
import { FeedAvatar } from './FeedAvatar';
import { useFeedMembers } from './FeedMembersContext';

interface FeedRowCommentsState {
  count: number;
  latest: RowComment | null;
}

const EMPTY_COMMENTS: FeedRowCommentsState = { count: 0, latest: null };

function summarizeComments(comments: RowComment[]): FeedRowCommentsState {
  let latest: RowComment | null = null;

  // Ties resolve to the later map entry so a reply added within the same
  // second as an older comment still wins.
  comments.forEach((comment) => {
    if (!latest || comment.createdAt >= latest.createdAt) latest = comment;
  });

  return { count: comments.length, latest };
}

/**
 * Observe a row's comments without creating the comments map. Feed cards are
 * summary surfaces and must not write to rows they only display.
 */
export function useFeedRowComments(rowId: string): FeedRowCommentsState {
  const rowDoc = useRowMap()?.[rowId];
  const [state, setState] = useState<FeedRowCommentsState>(EMPTY_COMMENTS);

  useEffect(() => {
    if (!rowDoc) {
      setState(EMPTY_COMMENTS);
      return;
    }

    const rowSharedRoot = rowDoc.getMap(YjsEditorKey.data_section);
    let commentsMap = getCommentsMap(rowDoc);

    const update = () => {
      const next = summarizeComments(getRowComments(rowDoc));

      setState((current) => (current.count === next.count && current.latest?.id === next.latest?.id ? current : next));
    };

    const syncCommentsMap = () => {
      const nextCommentsMap = getCommentsMap(rowDoc);

      if (nextCommentsMap !== commentsMap) {
        commentsMap?.unobserveDeep(update);
        commentsMap = nextCommentsMap;
        commentsMap?.observeDeep(update);
      }

      update();
    };

    rowSharedRoot.observe(syncCommentsMap);
    commentsMap?.observeDeep(update);
    update();

    return () => {
      rowSharedRoot.unobserve(syncCommentsMap);
      commentsMap?.unobserveDeep(update);
    };
  }, [rowDoc]);

  return state;
}

function FeedCommentSummary({ count, latest, rowId }: { count: number; latest: RowComment; rowId: string }) {
  const { t } = useTranslation();
  const { resolveMember } = useFeedMembers();
  const commenter = resolveMember(latest.authorId);
  const relativeTime = formatFeedRelativeTime(latest.createdAt, t, dayjs());

  return (
    <div className='mt-3 flex items-center gap-2' data-testid={`feed-comment-summary-${rowId}`}>
      <FeedAvatar member={commenter} />
      <span className='text-[13px] text-text-secondary' data-testid={`feed-comment-count-${rowId}`}>
        {t('globalComment.replies', { count })}
      </span>
      <span className='text-[13px] text-text-tertiary'>{relativeTime}</span>
    </div>
  );
}

function FeedAddCommentInput({ rowId, onActiveChange }: { rowId: string; onActiveChange: (active: boolean) => void }) {
  const { t } = useTranslation();
  const { currentCommentAuthorId, currentUser, resolveMember, mentionableUsers, canComment } = useFeedMembers();
  const addComment = useAddCommentDispatch(rowId);
  const author = resolveMember(currentCommentAuthorId) ?? {
    name: currentUser?.name ?? '',
    email: currentUser?.email ?? '',
    avatarUrl: currentUser?.avatar ?? null,
  };

  return (
    <div
      className='mt-3 flex items-start gap-2'
      data-feed-interactive='true'
      data-testid={`feed-add-comment-${rowId}`}
      onClick={(event) => event.stopPropagation()}
    >
      <FeedAvatar member={author} />
      <CommentComposer
        onActiveChange={onActiveChange}
        placeholder={t('rowComment.addComment')}
        members={mentionableUsers}
        testIds={{
          collapsed: `feed-add-comment-collapsed-${rowId}`,
          input: `feed-add-comment-input-${rowId}`,
          submit: `feed-add-comment-submit-${rowId}`,
          attachment: `feed-add-comment-attachment-${rowId}`,
        }}
        onSubmit={(content, attachments) => {
          if (!canComment || !currentCommentAuthorId) return;
          return addComment(content, currentCommentAuthorId, undefined, attachments);
        }}
      />
    </div>
  );
}

/**
 * Desktop `FeedCard._buildCommentSection`: a summary of the latest reply when
 * comments exist, otherwise an inline add-comment input when allowed.
 */
export const FeedCommentSection = memo(function FeedCommentSection({ rowId }: { rowId: string }) {
  const { count, latest } = useFeedRowComments(rowId);
  const { canComment, currentCommentAuthorId } = useFeedMembers();
  const [composerActive, setComposerActive] = useState(false);

  // A remote first reply must not unmount an active composer and discard its
  // text, mentions, attachments or pending uploads. Summarize once it closes.
  if (count > 0 && latest && !composerActive) return <FeedCommentSummary count={count} latest={latest} rowId={rowId} />;
  if (!canComment || !currentCommentAuthorId) return null;

  return <FeedAddCommentInput rowId={rowId} onActiveChange={setComposerActive} />;
});

export default FeedCommentSection;

import dayjs from 'dayjs';
import { lazy, memo, MouseEvent, Suspense, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useRowMap } from '@/application/database-yjs';
import { useAddCommentDispatch } from '@/application/database-yjs/comment_dispatch';
import { getCommentsMap, getRowComments } from '@/application/database-yjs/row_comment';
import { RowComment } from '@/application/row-comment.type';
import { YjsEditorKey } from '@/application/types';
import { Popover } from '@/components/_shared/popover';
import { CommentComposer } from '@/components/database/components/database-row/comment/CommentComposer';

import { formatFeedRelativeTime } from './feed.utils';
import { FeedAvatar } from './FeedAvatar';
import { useFeedMembers } from './FeedMembersContext';

const FeedDiscussion = lazy(() => import('@/components/database/components/database-row/comment/RowCommentList'));

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

function FeedCommentSummary({
  count,
  expanded,
  latest,
  onToggle,
  panelId,
  rowId,
}: {
  count: number;
  expanded: boolean;
  latest: RowComment | null;
  onToggle: (event: MouseEvent<HTMLButtonElement>) => void;
  panelId: string;
  rowId: string;
}) {
  const { t } = useTranslation();
  const { resolveMember } = useFeedMembers();
  const commenter = latest ? resolveMember(latest.authorId) : undefined;
  const relativeTime = latest ? formatFeedRelativeTime(latest.createdAt, t, dayjs()) : '';

  return (
    <button
      aria-controls={panelId}
      aria-expanded={expanded}
      aria-haspopup='dialog'
      className='mt-3 flex items-center gap-2 rounded focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fill-theme-thick'
      data-testid={`feed-comment-summary-${rowId}`}
      onClick={onToggle}
      type='button'
    >
      {latest ? <FeedAvatar member={commenter} /> : null}
      <span className='text-[13px] text-text-secondary' data-testid={`feed-comment-count-${rowId}`}>
        {t('globalComment.replies', { count })}
      </span>
      <span className='text-[13px] text-text-tertiary'>{relativeTime}</span>
    </button>
  );
}

function FeedAddCommentInput({ rowId, hasComments }: { rowId: string; hasComments: boolean }) {
  const { t } = useTranslation();
  const { currentCommentAuthorId, currentUser, resolveMember, mentionableUsers, canComment } = useFeedMembers();
  const addComment = useAddCommentDispatch(rowId);
  const [active, setActive] = useState(false);
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
      style={{ display: hasComments && !active ? 'none' : undefined }}
      onClick={(event) => event.stopPropagation()}
    >
      <FeedAvatar member={author} />
      <CommentComposer
        onActiveChange={setActive}
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

/** Keep discussion and composing available without leaving the feed. */
export const FeedCommentSection = memo(function FeedCommentSection({ rowId }: { rowId: string }) {
  const { t } = useTranslation();
  const { count, latest } = useFeedRowComments(rowId);
  const { canComment, currentCommentAuthorId } = useFeedMembers();
  const [expanded, setExpanded] = useState(false);
  const [hasOpenedDiscussion, setHasOpenedDiscussion] = useState(false);
  const [anchorEl, setAnchorEl] = useState<HTMLButtonElement | null>(null);
  const panelId = useId();

  if (!latest && !hasOpenedDiscussion && (!canComment || !currentCommentAuthorId)) return null;

  return (
    <div data-feed-interactive='true' onClick={(event) => event.stopPropagation()}>
      {latest || hasOpenedDiscussion ? (
        <FeedCommentSummary
          count={count}
          expanded={expanded}
          latest={latest}
          onToggle={(event) => {
            setAnchorEl(event.currentTarget);
            setHasOpenedDiscussion(true);
            setExpanded((current) => !current);
          }}
          panelId={panelId}
          rowId={rowId}
        />
      ) : null}

      {/* Keep drafts and pending uploads alive when the popover is dismissed. */}
      {hasOpenedDiscussion ? (
        <Popover
          open={expanded}
          anchorEl={anchorEl}
          onClose={() => setExpanded(false)}
          keepMounted
          disableRestoreFocus={false}
          disableEnforceFocus
          disableEscapeKeyDown
          anchorOrigin={{ vertical: 'top', horizontal: 'center' }}
          transformOrigin={{ vertical: 'bottom', horizontal: 'center' }}
          onKeyDownCapture={(event) => {
            if (
              event.defaultPrevented ||
              event.nativeEvent.isComposing ||
              event.nativeEvent.keyCode === 229 ||
              !event.currentTarget.contains(event.target as Node)
            ) return;

            // Nested menus handle their own Escape. Within a composer, first
            // dismiss mention suggestions; otherwise preserve the whole draft.
            const composer = (event.target as HTMLElement).closest('[data-comment-composer]');

            if (event.key === 'Escape' && !composer?.querySelector('[role="listbox"]')) {
              event.preventDefault();
              event.stopPropagation();
              setExpanded(false);
            }
          }}
        >
          <div
            aria-label={t('rowComment.comments')}
            className='max-h-[min(480px,70vh)] w-[400px] max-w-[calc(100vw-32px)] overflow-y-auto p-4'
            data-testid={`feed-discussion-${rowId}`}
            id={panelId}
            role='dialog'
            tabIndex={-1}
          >
            <Suspense fallback={null}>
              <FeedDiscussion includeResolved rowId={rowId} />
            </Suspense>
          </div>
        </Popover>
      ) : null}

      {/* This position stays stable when a first local or remote comment arrives. */}
      {canComment && currentCommentAuthorId ? (
        <FeedAddCommentInput rowId={rowId} hasComments={Boolean(latest) || expanded} />
      ) : null}
    </div>
  );
});

export default FeedCommentSection;

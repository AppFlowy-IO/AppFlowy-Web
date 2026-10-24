import dayjs from 'dayjs';
import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import {
  Column,
  useCellSelector,
  useDatabaseContext,
  useReadOnly,
  useRowDataSelector,
  useRowMetaSelector,
} from '@/application/database-yjs';
import { YDatabaseRow, YjsDatabaseKey } from '@/application/types';
import { canonicalizeUserUid } from '@/application/user-uid';
import { CommentDraftContext } from '@/components/database/components/database-row/comment/CommentDraftContext';
import { notify } from '@/components/_shared/notify';
import { useEditorPreviewId } from '@/components/editor/EditorPreviewContext';
import { cn } from '@/lib/utils';

import { FEED_CARD_INTRINSIC_HEIGHT, FEED_CARD_MAX_HEIGHT, FEED_EDITED_THRESHOLD_SECONDS } from './feed.constants';
import { formatFeedCreatorDate, isFeedInteractiveTarget, isFeedRowEdited, toUnixSeconds } from './feed.utils';
import { FeedAvatar } from './FeedAvatar';
import { FeedCardActions } from './FeedCardActions';
import { FeedCardBody } from './FeedCardBody';
import { FeedCardCover } from './FeedCardCover';
import { FeedCardProperties } from './FeedCardProperties';
import { FeedCommentSection } from './FeedCommentSection';
import { FeedDocumentPreview } from './FeedDocumentPreview';
import { useFeedMembers } from './FeedMembersContext';
import { FeedRowIcon } from './FeedRowIcon';
import { FeedRowReactions } from './FeedRowReactions';

interface FeedRowAttribution {
  createdAt?: number;
  createdBy: string | null;
  modifiedAt?: number;
}

const EMPTY_ATTRIBUTION: FeedRowAttribution = { createdBy: null };

// Long feeds skip layout and paint for off-screen cards; the intrinsic size
// keeps the scrollbar stable before a card is rendered.
const feedCardStyle: React.CSSProperties = {
  contentVisibility: 'auto',
  containIntrinsicSize: `auto ${FEED_CARD_INTRINSIC_HEIGHT}px`,
  maxHeight: FEED_CARD_MAX_HEIGHT,
};

function usePreviewNearViewport(cardRef: React.RefObject<HTMLElement>, enabled: boolean): boolean {
  const [nearViewport, setNearViewport] = useState(false);

  useEffect(() => {
    const element = cardRef.current;

    setNearViewport(false);
    if (!enabled || !element) return;

    if (typeof IntersectionObserver === 'undefined') {
      setNearViewport(true);
      return;
    }

    let active = true;
    const observer = new IntersectionObserver(
      (entries) => {
        if (active) setNearViewport(entries.some((entry) => entry.isIntersecting));
      },
      { rootMargin: '400px 0px' }
    );

    observer.observe(element);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [cardRef, enabled]);

  return enabled && nearViewport;
}

function readRowAttribution(row: YDatabaseRow | undefined): FeedRowAttribution {
  if (!row) return EMPTY_ATTRIBUTION;

  return {
    createdAt: toUnixSeconds(row.get(YjsDatabaseKey.created_at)),
    createdBy: canonicalizeUserUid(row.get(YjsDatabaseKey.created_by)),
    modifiedAt: toUnixSeconds(row.get(YjsDatabaseKey.last_modified)),
  };
}

/** Observe the row's creator and timestamps (Desktop reads them from `RowMetaPB`). */
export function useFeedRowAttribution(rowId: string): FeedRowAttribution {
  const { row } = useRowDataSelector(rowId);
  const [attribution, setAttribution] = useState<FeedRowAttribution>(() => readRowAttribution(row));

  useEffect(() => {
    const update = () => {
      const next = readRowAttribution(row);

      setAttribution((current) =>
        current.createdAt === next.createdAt &&
        current.createdBy === next.createdBy &&
        current.modifiedAt === next.modifiedAt
          ? current
          : next
      );
    };

    update();
    row?.observe(update);

    return () => {
      row?.unobserve(update);
    };
  }, [row]);

  return attribution;
}

function FeedCreatorInfo({ attribution, rowId }: { attribution: FeedRowAttribution; rowId: string }) {
  const { t } = useTranslation();
  const { resolveMember } = useFeedMembers();
  const creator = resolveMember(attribution.createdBy);
  const createdText =
    attribution.createdAt === undefined ? '' : formatFeedCreatorDate(attribution.createdAt, t, dayjs());
  const edited = isFeedRowEdited(attribution.createdAt, attribution.modifiedAt, FEED_EDITED_THRESHOLD_SECONDS);
  const dateText = createdText && edited ? `${createdText} ${t('globalComment.edited')}` : createdText;

  return (
    <div
      className='flex shrink-0 items-center gap-1.5 px-8 pb-3 pt-6 max-sm:px-4'
      data-testid={`feed-card-creator-${rowId}`}
    >
      <FeedAvatar member={creator} testId={`feed-card-creator-avatar-${rowId}`} />
      <div className='flex min-w-0 items-end gap-2'>
        <span
          className='truncate text-sm font-medium leading-5 text-text-primary'
          data-testid={`feed-card-creator-name-${rowId}`}
        >
          {creator?.name || creator?.email || t('feed.unknownCreator')}
        </span>
        {dateText ? (
          <span
            className='shrink-0 whitespace-nowrap text-xs leading-[18px] tracking-[0.1px] text-text-secondary'
            data-testid={`feed-card-created-at-${rowId}`}
          >
            {dateText}
          </span>
        ) : null}
      </div>
    </div>
  );
}

export interface FeedCardProps {
  fields?: Column[];
  hidden?: boolean;
  onDraftChange?: (rowId: string, hasDraft: boolean) => void;
  primaryFieldId: string;
  rowId: string;
}

/**
 * One feed post (the Figma feed card): cover, creator, title, properties and
 * document preview capped at 600px, then reactions and comments. Clicking the
 * card opens the row detail page unless the click landed on a control.
 */
export const FeedCard = memo(function FeedCard({
  fields,
  hidden = false,
  onDraftChange,
  primaryFieldId,
  rowId,
}: FeedCardProps) {
  const { t } = useTranslation();
  const readOnly = useReadOnly();
  const { activeViewId, bindRowSync, databasePageId, navigateToRow, navigateToView } = useDatabaseContext();
  const { resolveMember } = useFeedMembers();
  const meta = useRowMetaSelector(rowId);
  const cell = useCellSelector({ fieldId: primaryFieldId, rowId });
  const attribution = useFeedRowAttribution(rowId);
  const previewId = useEditorPreviewId();
  const cardRef = useRef<HTMLElement>(null);
  const draftIds = useRef(new Set<string>());
  const handleDraftChange = useCallback(
    (id: string, hasDraft: boolean) => {
      if (hasDraft) draftIds.current.add(id);
      else draftIds.current.delete(id);
      onDraftChange?.(rowId, draftIds.current.size > 0);
    },
    [onDraftChange, rowId]
  );
  // Only read inside the click handler, so a menu opening must not re-render the card.
  const actionsOpenRef = useRef(false);
  const handleActionsOpenChange = useCallback((open: boolean) => {
    actionsOpenRef.current = open;
  }, []);

  useEffect(() => {
    if (bindRowSync && rowId) bindRowSync(rowId);
  }, [bindRowSync, rowId]);

  const title = typeof cell?.data === 'string' ? cell.data.trim() : '';
  const hasCreator = Boolean(resolveMember(attribution.createdBy));
  const hasDocument = meta?.isEmptyDocument === false && Boolean(meta.documentId);
  const hasCover = !hidden && Boolean(meta?.cover?.data);
  // Linked databases still render inside a preview, but their Feed cards must
  // not load another row document (which can link straight back to this Feed).
  const showPreview = usePreviewNearViewport(cardRef, !previewId && !hidden && hasDocument);

  const openRow = useCallback(() => {
    navigateToRow?.(rowId);
  }, [navigateToRow, rowId]);

  // Same route the row peek's "Open as full page" takes for a database view.
  const openRowPage = useCallback(() => {
    navigateToView?.(activeViewId || databasePageId, rowId).catch(() => {
      notify.error(t('chat.openPagePreviewFailedToast'));
    });
  }, [activeViewId, databasePageId, navigateToView, rowId, t]);

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLElement>) => {
      if (actionsOpenRef.current || isFeedInteractiveTarget(event.target, event.currentTarget)) return;

      // Keep the host document editor from treating the click as a selection change.
      event.stopPropagation();
      openRow();
    },
    [openRow]
  );

  return (
    <article
      className={cn(
        'group/feed-card relative w-full cursor-pointer flex-col overflow-hidden rounded-500 border border-border-primary bg-surface-layer-02',
        'shadow-[0_2px_12px_1px_rgba(0,0,0,0.02)] transition-colors hover:border-border-primary-hover',
        // A display utility outranks the `hidden` attribute, so a retained
        // draft card must drop it while a search hides the card.
        hidden ? 'hidden' : 'flex'
      )}
      data-row-id={rowId}
      data-testid={`feed-card-${rowId}`}
      hidden={hidden}
      onClick={handleClick}
      ref={cardRef}
      style={feedCardStyle}
    >
      <button
        aria-label={`${t('feed.openRow')}: ${title || t('feed.untitled')}`}
        className='pointer-events-none absolute inset-0 z-10 rounded-500 bg-transparent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-fill-theme-thick'
        data-testid={`feed-card-open-${rowId}`}
        onClick={(event) => {
          event.stopPropagation();
          openRow();
        }}
        type='button'
      />

      {hasCover && meta ? <FeedCardCover cover={meta.cover} rowId={rowId} /> : null}

      {hasCreator ? <FeedCreatorInfo attribution={attribution} rowId={rowId} /> : null}

      <FeedCardBody
        className={hasCreator ? undefined : 'pt-6'}
        onOpenFullPage={navigateToView ? openRowPage : undefined}
        rowId={rowId}
      >
        <div className='flex min-w-0 flex-col'>
          <div className='flex items-center gap-2' data-testid={`feed-card-header-${rowId}`}>
            {meta?.icon ? <FeedRowIcon icon={meta.icon} /> : null}
            <h3
              className={cn(
                'line-clamp-2 min-w-0 flex-1 text-2xl font-semibold leading-9',
                title ? 'text-text-primary' : 'text-text-tertiary'
              )}
              data-testid={`feed-card-title-${rowId}`}
              data-untitled={!title}
            >
              {title || t('feed.untitled')}
            </h3>
          </div>

          {fields ? <FeedCardProperties fields={fields} primaryFieldId={primaryFieldId} rowId={rowId} /> : null}
        </div>

        {showPreview && meta ? <FeedDocumentPreview documentId={meta.documentId} rowId={rowId} /> : null}
      </FeedCardBody>

      <div
        className='flex shrink-0 flex-col gap-1.5 px-[26px] pb-4 max-sm:px-2.5'
        data-testid={`feed-card-footer-${rowId}`}
      >
        <FeedRowReactions rowId={rowId} />
        <CommentDraftContext.Provider value={handleDraftChange}>
          <FeedCommentSection rowId={rowId} visible={!hidden} />
        </CommentDraftContext.Provider>
      </div>

      <FeedCardActions editable={!readOnly} hasCover={hasCover} onOpenChange={handleActionsOpenChange} rowId={rowId} />
    </article>
  );
});

export default FeedCard;

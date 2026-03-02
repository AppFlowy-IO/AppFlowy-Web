import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { DateFormat } from '@/application/types';
import { MetadataKey } from '@/application/user-metadata';
import { ReactComponent as ArchiveIcon } from '@/assets/icons/archive.svg';
import { ReactComponent as CheckCircleIcon } from '@/assets/icons/check_circle.svg';
import { ReactComponent as MainReminderIcon } from '@/assets/icons/m_notification_reminder.svg';
import { ReactComponent as BadgeAtIcon } from '@/assets/icons/notification_icon_at.svg';
import { ReactComponent as BadgeBellIcon } from '@/assets/icons/notification_bell.svg';
import { ReactComponent as BadgeReminderIcon } from '@/assets/icons/notification_reminder_badge.svg';
import { ReactComponent as ReminderClockIcon } from '@/assets/icons/reminder_clock.svg';
import { useAppHandlers } from '@/components/app/app.hooks';
import { useCurrentUser } from '@/components/main/app.hooks';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getDateFormat, getTimeFormat, renderDate } from '@/utils/time';

import { buildSecondary, formatTimestamp, humanizeType, pickText } from './helpers';
import { Notification, NotificationTabType } from './types';

interface NotificationItemProps {
  notification: Notification;
  tab: NotificationTabType;
  onMarkRead: (ids: string[]) => Promise<void>;
  onArchive: (ids: string[]) => Promise<void>;
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Type icon — matches desktop NotificationTypeIcon (42x36 stacked)
// Main: 32px — the full m_notification_reminder SVG (lavender circle + purple clock)
// Badge: 20px circle at bottom-right with type-specific 12px icon
// ---------------------------------------------------------------------------
function NotificationTypeIcon({ type }: { type: string }) {
  const BadgeIcon =
    type === 'mention' || type === 'comment_reply' || type === 'comment_on_page'
      ? BadgeAtIcon
      : type === 'reminder'
        ? BadgeReminderIcon
        : BadgeBellIcon;

  return (
    <div className={'relative h-9 w-[42px] shrink-0'}>
      {/* Main 32px — desktop m_notification_reminder.svg with baked-in lavender bg + purple clock */}
      <MainReminderIcon className={'h-8 w-8'} />
      {/* Badge 20px circle — bottom-right */}
      <div
        className={
          'absolute bottom-0 right-0 flex h-5 w-5 items-center justify-center rounded-full bg-fill-primary'
        }
      >
        <BadgeIcon className={'h-3 w-3 text-icon-primary'} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared header row — title (left) + timestamp + unread dot (right)
// Desktop: height 22px, title 14/medium, timestamp 12/regular, dot 7x7
// ---------------------------------------------------------------------------
function NotificationHeader({
  title,
  createdAt,
  isRead,
}: {
  title: string;
  createdAt: string;
  isRead: boolean;
}) {
  return (
    <div className={'flex h-[22px] items-center'}>
      <span className={'flex-1 truncate text-sm font-medium leading-[22px] text-text-primary'}>
        {title}
      </span>
      <span className={'shrink-0 text-xs leading-4 text-text-secondary'}>
        {formatTimestamp(createdAt)}
      </span>
      {!isRead && (
        <span className={'ml-1 inline-block h-[7px] w-[7px] shrink-0 rounded-full bg-fill-error-thick'} />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Type-specific content
// ---------------------------------------------------------------------------
function MentionContent({ notification }: { notification: Notification }) {
  const actor = pickText(notification.metadata, ['actor_name', 'requester_name', 'inviter_name']);
  const pageName = pickText(notification.metadata, ['page_name']);
  const pagePath = pickText(notification.metadata, ['page_path']);
  const secondary = buildSecondary(actor, pageName);
  const detail = pagePath || pageName;

  const title =
    notification.type === 'mention'
      ? 'Mentioned You'
      : humanizeType(notification.type);

  return (
    <div className={'flex min-w-0 flex-1 flex-col'}>
      <NotificationHeader title={title} createdAt={notification.createdAt} isRead={notification.isRead} />
      {secondary && (
        <div className={'truncate text-xs leading-[18px] text-text-secondary'}>{secondary}</div>
      )}
      {detail && (
        <div className={'mt-0.5 line-clamp-2 text-sm leading-5 text-text-primary'}>{detail}</div>
      )}
    </div>
  );
}

function ReminderContent({ notification }: { notification: Notification }) {
  const { t } = useTranslation();
  const currentUser = useCurrentUser();
  const pageName = pickText(notification.metadata, ['page_name']);
  const scheduledAt = notification.metadata.scheduled_at as number | undefined;
  const includeTime = notification.metadata.include_time === true
    || notification.metadata.include_time === 1
    || notification.metadata.include_time === '1'
    || notification.metadata.include_time === 'true';

  const scheduledLabel = useMemo(() => {
    if (!scheduledAt || scheduledAt <= 0) return '';

    const dateFormat = (currentUser?.metadata?.[MetadataKey.DateFormat] as DateFormat) ?? DateFormat.Local;
    const dateFmt = getDateFormat(dateFormat);
    const dateStr = renderDate(String(scheduledAt), dateFmt, true);

    if (includeTime) {
      const timeFmt = getTimeFormat();
      const timeStr = renderDate(String(scheduledAt), timeFmt, true);

      return `@${dateStr} ${timeStr}`;
    }

    return `@${dateStr}`;
  }, [scheduledAt, includeTime, currentUser?.metadata]);

  return (
    <div className={'flex min-w-0 flex-1 flex-col'}>
      <NotificationHeader
        title={t('settings.notifications.titles.reminder', { defaultValue: 'Reminder' })}
        createdAt={notification.createdAt}
        isRead={notification.isRead}
      />
      {pageName && (
        <div className={'truncate text-xs leading-[18px] text-text-secondary'}>{pageName}</div>
      )}
      {scheduledLabel && (
        <div className={'mt-0.5 flex items-center gap-1'}>
          <ReminderClockIcon className={'h-3.5 w-3.5 shrink-0 text-text-secondary'} />
          <span className={'truncate text-xs leading-[18px] text-text-secondary'}>{scheduledLabel}</span>
        </div>
      )}
    </div>
  );
}

function GenericContent({ notification }: { notification: Notification }) {
  const actor = pickText(notification.metadata, ['actor_name', 'requester_name', 'inviter_name']);
  const pageName = pickText(notification.metadata, ['page_name']);
  const workspace = pickText(notification.metadata, ['workspace_name']);
  const secondary = buildSecondary(actor, pageName || workspace);

  const access = pickText(notification.metadata, ['new_access_level', 'access_level', 'new_role']);
  let detail = '';

  if (access && pageName) detail = `${pageName} (${access})`;
  else if (access) detail = access;
  else if (pageName) detail = pageName;
  else if (workspace) detail = workspace;

  return (
    <div className={'flex min-w-0 flex-1 flex-col'}>
      <NotificationHeader
        title={humanizeType(notification.type)}
        createdAt={notification.createdAt}
        isRead={notification.isRead}
      />
      {secondary && (
        <div className={'truncate text-xs leading-[18px] text-text-secondary'}>{secondary}</div>
      )}
      {detail && (
        <div className={'mt-0.5 line-clamp-2 text-sm leading-5 text-text-primary'}>{detail}</div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main NotificationItem
// ---------------------------------------------------------------------------
function NotificationItem({ notification, tab, onMarkRead, onArchive, onClose }: NotificationItemProps) {
  const { t } = useTranslation();
  const { toView } = useAppHandlers();
  const actionInFlightRef = useRef(false);

  const blockId = notification.metadata.block_id as string | undefined;

  const handleClick = useCallback(async () => {
    if (actionInFlightRef.current) return;
    actionInFlightRef.current = true;

    try {
      if (notification.viewId) {
        await toView(notification.viewId, blockId);
      }

      if (!notification.isRead) {
        await onMarkRead([notification.id]);
      }

      onClose();
    } finally {
      actionInFlightRef.current = false;
    }
  }, [notification.viewId, notification.isRead, notification.id, toView, blockId, onMarkRead, onClose]);

  const handleMarkRead = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (actionInFlightRef.current) return;
      actionInFlightRef.current = true;
      try {
        await onMarkRead([notification.id]);
      } finally {
        actionInFlightRef.current = false;
      }
    },
    [notification.id, onMarkRead]
  );

  const handleArchive = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      if (actionInFlightRef.current) return;
      actionInFlightRef.current = true;
      try {
        await onArchive([notification.id]);
      } finally {
        actionInFlightRef.current = false;
      }
    },
    [notification.id, onArchive]
  );

  const isArchiveTab = tab === NotificationTabType.Archived;

  // Type-specific content
  const content =
    notification.type === 'mention' ||
    notification.type === 'comment_reply' ||
    notification.type === 'comment_on_page' ? (
      <MentionContent notification={notification} />
    ) : notification.type === 'reminder' ? (
      <ReminderContent notification={notification} />
    ) : (
      <GenericContent notification={notification} />
    );

  return (
    <div
      role={'button'}
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          void handleClick();
        }
      }}
      className={
        'group relative mx-2 flex cursor-pointer items-start gap-3 rounded-[8px] py-3.5 pl-4 pr-3.5 hover:bg-fill-content-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-fill-theme-thick'
      }
    >
      {/* Type icon (42x36) */}
      <NotificationTypeIcon type={notification.type} />

      {/* Content */}
      {content}

      {/* Hover actions — positioned top-right, matching desktop */}
      {!isArchiveTab && (
        <div
          className={
            'absolute right-2 top-2 flex items-center gap-1.5 rounded-[6px] border border-border-primary bg-background-primary px-1 py-0.5 opacity-0 shadow-sm transition-opacity group-hover:opacity-100'
          }
        >
          {!notification.isRead && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={handleMarkRead}
                  className={'flex h-6 w-6 items-center justify-center rounded text-icon-secondary hover:text-icon-primary'}
                >
                  <CheckCircleIcon className={'h-4 w-4'} />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t('settings.notifications.action.markAsRead')}</TooltipContent>
            </Tooltip>
          )}
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={handleArchive}
                className={'flex h-6 w-6 items-center justify-center rounded text-icon-secondary hover:text-icon-primary'}
              >
                <ArchiveIcon className={'h-4 w-4'} />
              </button>
            </TooltipTrigger>
            <TooltipContent>{t('settings.notifications.action.archive')}</TooltipContent>
          </Tooltip>
        </div>
      )}
    </div>
  );
}

export default NotificationItem;

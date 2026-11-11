/**
 * The editor @ picker's result rendering for the item details (MEN-WEB-13, `mentionItemDetails.ts`):
 * the avatar of a person result, whether the item details are on or off, and, while they are on, the
 * leading icon and the label with its breadcrumb and reason chip.
 */
import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { MentionSearchResultItem, MentionTargetKind, ViewLayout } from '@/application/types';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

import {
  isMentionPageLikeKind,
  MentionItemDetails,
  mentionItemBreadcrumb,
  mentionItemIsContext,
  mentionItemLocalView,
  mentionItemPersonId,
  mentionItemRosterPerson,
  mentionImageSource,
  mentionPersonAvatarSource,
  MentionReasonChip,
  mentionReasonChip,
  mentionReasonChipLabel,
} from './mentionItemDetails';

/**
 * A person result's avatar: `src`, else the item's `icon` when it is an image URL string, else the
 * initials. An object `icon`, as servers type it, never reaches the image.
 */
export function MentionPersonAvatar({
  item,
  title,
  src,
}: {
  item: MentionSearchResultItem;
  title: string;
  src?: string;
}) {
  const displayName = title || item.title || item.subtitle || item.object_id || '?';

  return (
    <Avatar size={'sm'} shape={'circle'} className={'h-6 w-6 min-w-6'}>
      <AvatarImage src={src ?? mentionImageSource(item.icon)} alt={displayName} />
      <AvatarFallback name={displayName} className={'text-xs font-medium'}>
        {displayName}
      </AvatarFallback>
    </Avatar>
  );
}

/**
 * The leading icon of a result with the item details on: a person's roster avatar, or the icon the
 * local index holds for a page or database (its own icon, else its layout's). Anything else, and a
 * view the index does not know, shows `fallback`, the icon the picker shows without the details.
 */
export function MentionResultDetailsIcon({
  item,
  navKey,
  title,
  details,
  fallback,
}: {
  item: MentionSearchResultItem;
  navKey: string;
  title: string;
  details: MentionItemDetails;
  fallback: ReactNode;
}) {
  if (item.kind === MentionTargetKind.Person) {
    const person = mentionItemRosterPerson(details.snapshot, item);

    return <MentionPersonAvatar item={item} title={title} src={mentionPersonAvatarSource(item, person)} />;
  }

  const view = mentionItemLocalView(details.snapshot, item, navKey);

  // PageIcon draws every layout this client knows when the view has no icon of its own.
  if (!view || (!view.icon && ViewLayout[view.layout] === undefined)) return <>{fallback}</>;

  return (
    <span data-testid={'mention-view-icon'} className={'flex h-5 w-5 min-w-5 items-center justify-center'}>
      <PageIcon
        view={{ icon: view.icon, layout: view.layout }}
        iconSize={20}
        className={'flex h-5 w-5 items-center justify-center text-base leading-5 text-icon-primary'}
      />
    </span>
  );
}

/** A muted pill on the result's row, saying why it is listed ({@link mentionReasonChip}). */
function MentionResultReasonChip({ chip, nowMs }: { chip: MentionReasonChip; nowMs: number }) {
  const { t } = useTranslation();

  return (
    <span
      data-testid={'mention-reason-chip'}
      data-reason={chip.kind}
      className={
        'shrink-0 whitespace-nowrap rounded-[4px] border border-border-primary px-1.5 text-xs leading-5 text-text-tertiary'
      }
    >
      {mentionReasonChipLabel(chip, nowMs, t)}
    </span>
  );
}

/**
 * The label of a result with the item details on: the title; under it the breadcrumb of a page,
 * database or row, or the subtitle of anything else (a person's address); and at the end of the row
 * its reason chip, if any.
 */
export function MentionResultDetailsLabel({
  item,
  navKey,
  title,
  details,
}: {
  item: MentionSearchResultItem;
  navKey: string;
  title: string;
  details: MentionItemDetails;
}) {
  const pageLike = isMentionPageLikeKind(item.kind);
  const secondary = pageLike ? mentionItemBreadcrumb(item) : item.subtitle;
  const view = pageLike ? mentionItemLocalView(details.snapshot, item, navKey) : undefined;
  const personId = mentionItemPersonId(item);
  const nowMs = Date.now();
  const chip = mentionReasonChip({
    item,
    view,
    present:
      personId !== undefined &&
      (details.presentPersonIds.has(personId) || details.presentPersonIds.has(personId.toLowerCase())),
    context: mentionItemIsContext(item, view, details.contextViewId, navKey),
    nowMs,
  });

  return (
    <span className={'flex min-w-0 flex-1 items-center gap-2'}>
      <span className={'flex min-w-0 flex-1 flex-col items-start'}>
        <span className={'max-w-full truncate'}>{title}</span>
        {secondary && (
          <span
            data-testid={pageLike ? 'mention-breadcrumb' : undefined}
            title={pageLike ? secondary : undefined}
            className={'max-w-full truncate text-xs text-text-secondary'}
          >
            {secondary}
          </span>
        )}
      </span>
      {chip && <MentionResultReasonChip chip={chip} nowMs={nowMs} />}
    </span>
  );
}

import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType, GridGroup } from '@/application/database-yjs';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { ListGroupHeader, useCreateListGroupRow } from '@/components/database/list/ListGroup';
import { cn } from '@/lib/utils';

interface TimelineGroupRowProps {
  group: GridGroup;
  fieldId?: string;
  fieldName?: string;
  fieldType?: FieldType;
  groupConfigId?: string;
  sidebarWidth: number;
  showSidebar: boolean;
}

/**
 * A group's header row: the List's group header in the docked table (toggle,
 * value, count, actions) and a tinted band across the canvas, as in Notion.
 */
export const TimelineGroupRow = memo(
  ({ group, fieldId, fieldName, fieldType, groupConfigId, sidebarWidth, showSidebar }: TimelineGroupRowProps) => (
    <div className='flex h-full w-full' data-testid={`timeline-group-${group.id}`}>
      <div
        className='sticky left-0 z-10 flex h-full shrink-0 items-center overflow-hidden border-b border-r border-border-primary bg-background-primary'
        style={{ width: sidebarWidth }}
      >
        <ListGroupHeader
          group={group}
          fieldId={fieldId}
          fieldName={fieldName}
          fieldType={fieldType}
          groupConfigId={groupConfigId}
          className={cn('h-full w-full', showSidebar ? 'pl-1' : 'pl-0')}
        />
      </div>
      <div className='h-full flex-1 border-b border-border-primary bg-fill-content' />
    </div>
  )
);

TimelineGroupRow.displayName = 'TimelineGroupRow';

interface TimelineGroupFooterProps {
  group: GridGroup;
  fieldId?: string;
  sidebarWidth: number;
  showSidebar: boolean;
}

/** Notion's per-group "+ New": creates a row already holding the group's value. */
export const TimelineGroupFooter = memo(({ group, fieldId, sidebarWidth, showSidebar }: TimelineGroupFooterProps) => {
  const { t } = useTranslation();
  const createRow = useCreateListGroupRow(fieldId, group.id, true);

  return (
    <div className='flex h-full w-full'>
      <div
        role='button'
        tabIndex={0}
        className={cn(
          'sticky left-0 z-10 flex h-full shrink-0 cursor-pointer items-center gap-1.5 overflow-hidden border-b border-r border-border-primary bg-background-primary text-sm text-text-tertiary hover:bg-fill-content-hover',
          showSidebar ? 'px-2' : 'justify-center'
        )}
        style={{ width: sidebarWidth }}
        data-testid={`timeline-group-new-row-${group.id}`}
        aria-label={t('grid.row.newRow', { defaultValue: 'New row' })}
        onClick={() => void createRow()}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            void createRow();
          }
        }}
      >
        <PlusIcon aria-hidden className='h-4 w-4' />
        {showSidebar ? t('grid.row.newRow', { defaultValue: 'New row' }) : null}
      </div>
      <div className='h-full flex-1 border-b border-border-primary' />
    </div>
  );
});

TimelineGroupFooter.displayName = 'TimelineGroupFooter';

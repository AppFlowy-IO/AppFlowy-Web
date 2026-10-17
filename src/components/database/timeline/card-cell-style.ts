import { FieldType } from '@/application/database-yjs/database.type';
import { cn } from '@/lib/utils';

/**
 * Desktop builds the timeline's table cells and bar chips with
 * `desktopListCardCellStyleMap` (`database_timeline.dart` `_tableCell` /
 * `_barContent`), so they share the List's cell text style: caption 12/18
 * regular in the primary text color, Person as 20px avatars 4px apart (the
 * names stay in the DOM for screen readers), CreatedBy/LastEditedBy with their
 * names, and Media in the secondary color (`MediaCardCell` ignores the map's
 * text style). Applied to the wrapper around `CardField`, which keeps the
 * Board's cell layout.
 */
export function timelineCardCellClassName(fieldType?: FieldType) {
  return cn(
    'text-xs font-normal leading-[18px]',
    fieldType === FieldType.Media ? 'text-text-secondary' : 'text-text-primary',
    // PersonCell's own `gap-1` is the 4px avatar spacing.
    fieldType === FieldType.Person && '[&_.person-cell-name]:sr-only',
    // CreatedBy / LastEditedBy keep their names, in the map's 12px text style.
    (fieldType === FieldType.CreatedBy || fieldType === FieldType.LastEditedBy) &&
      '[&_.attribution-name]:text-xs [&_.attribution-name]:leading-[18px]',
    fieldType === FieldType.Rollup && '[&_.rollup-person-name]:text-xs [&_.rollup-person-name]:leading-[18px]',
    // `ChecklistProgressBar` renders its percentage in `textStyle` too.
    fieldType === FieldType.Checklist && '[&_.checklist-progress-label]:text-text-primary'
  );
}

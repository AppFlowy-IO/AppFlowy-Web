import { ComponentType, SVGProps } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as ViewDataSourceIcon } from '@/assets/icons/arrow_up_right.svg';
import { MobileSheet, MobileSheetItem } from '@/components/_shared/mobile-drawer/MobileSheet';

import { buildWidgetMenuEntries, NO_WIDGET_MOVES, WidgetMenuEntryId } from '../widget-moves';
import { useWidgetContext, WidgetActions } from '../WidgetContext';

/** The View-mode entries the phone sheet can show, with their label and icon. */
const SHEET_ENTRIES: Partial<
  Record<
    WidgetMenuEntryId,
    {
      key: string;
      defaultValue: string;
      icon: ComponentType<SVGProps<SVGSVGElement>>;
      run: (actions: WidgetActions) => void;
    }
  >
> = {
  'view-data-source': {
    key: 'dashboard.widget.viewDataSource',
    defaultValue: 'View data source',
    icon: ViewDataSourceIcon,
    run: (actions) => actions.open(),
  },
};

/**
 * The widget menu on a phone (WP14 §1.4.2): a bottom sheet titled with the
 * widget's name, one row per entry of the View-mode menu model, which is
 * "View data source" alone (a phone never edits). Choosing it closes the sheet
 * first, then opens the view.
 */
export function WidgetMenuSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { t } = useTranslation();
  const { name, actions } = useWidgetContext();
  const entries = buildWidgetMenuEntries({ editing: false, canDuplicate: false, moveTargets: NO_WIDGET_MOVES });

  return (
    <MobileSheet onOpenChange={onOpenChange} open={open} sheet='widget-menu' title={name || t('untitled')}>
      {entries.map((entry) => {
        const sheetEntry = SHEET_ENTRIES[entry.id];

        if (!sheetEntry) return null;
        const Icon = sheetEntry.icon;

        return (
          <MobileSheetItem
            disabled={entry.disabled}
            icon={<Icon aria-hidden='true' />}
            id={entry.id}
            key={entry.id}
            label={t(sheetEntry.key, { defaultValue: sheetEntry.defaultValue })}
            onSelect={() => {
              onOpenChange(false);
              sheetEntry.run(actions);
            }}
          />
        );
      })}
    </MobileSheet>
  );
}

export default WidgetMenuSheet;

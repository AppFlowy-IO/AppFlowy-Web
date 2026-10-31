import { ComponentType, SVGProps } from 'react';
import { useTranslation } from 'react-i18next';

import { DASHBOARD_GEOMETRY } from '@/application/database-yjs/dashboard-geometry';
import { useSetViewOpenPagesIn, useViewOpenPagesIn } from '@/application/database-yjs/dispatch/open-pages-in';
import { OPEN_PAGES_IN_VALUES, OpenPagesIn, resolveOpenPagesIn } from '@/application/database-yjs/open-pages-in';
import { DatabaseViewLayout } from '@/application/types';
import { ReactComponent as CenterPeekIcon } from '@/assets/icons/center_peek.svg';
import { ReactComponent as FullPageIcon } from '@/assets/icons/full_page.svg';
import { ReactComponent as SidePeekIcon } from '@/assets/icons/side_peek.svg';
import {
  DropdownMenuItem,
  DropdownMenuItemTick,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';

const MENU = DASHBOARD_GEOMETRY.menu;

const OPTIONS: Record<
  OpenPagesIn,
  { labelKey: string; defaultLabel: string; Icon: ComponentType<SVGProps<SVGSVGElement>> }
> = {
  side_peek: { labelKey: 'grid.openPagesIn.sidePeek', defaultLabel: 'Side peek', Icon: SidePeekIcon },
  center_peek: { labelKey: 'grid.openPagesIn.centerPeek', defaultLabel: 'Center peek', Icon: CenterPeekIcon },
  full_page: { labelKey: 'grid.openPagesIn.fullPage', defaultLabel: 'Full page', Icon: FullPageIcon },
};

/**
 * "Open pages in ›" in a widget's settings host (WP13 §3.8): how the widget's
 * view opens its records. Non-chart layouts only (a chart's records open
 * from its drill-down, which keeps the default). The check marks the resolved
 * value (Side peek while nothing is stored); a choice writes only the view's
 * `open_pages_in`.
 */
export function WidgetOpenPagesInRow({ viewId, layout }: { viewId: string; layout: DatabaseViewLayout | null }) {
  const { t } = useTranslation();
  const raw = useViewOpenPagesIn(viewId);
  const setOpenPagesIn = useSetViewOpenPagesIn();

  if (layout === null || layout === DatabaseViewLayout.Chart) return null;
  const resolved = resolveOpenPagesIn(raw, 'dashboard_widget');
  const current = OPTIONS[resolved];

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger
        data-parity-id='dash-widget-settings-row'
        data-testid='dashboard-widget-settings-open-pages-in'
      >
        <current.Icon aria-hidden='true' />
        <span className='flex-1 truncate' data-parity-id='dash-widget-settings-row__label'>
          {t('grid.openPagesIn.title', { defaultValue: 'Open pages in' })}
        </span>
        <span
          className='ml-auto max-w-[120px] truncate text-xs text-text-secondary'
          data-parity-id='dash-widget-settings-row__value'
        >
          {t(current.labelKey, { defaultValue: current.defaultLabel })}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent
          data-testid='dashboard-widget-settings-open-pages-in-menu'
          style={{ width: MENU.width, borderRadius: MENU.radius, padding: MENU.padding }}
        >
          {OPEN_PAGES_IN_VALUES.map((value) => {
            const { Icon, labelKey, defaultLabel } = OPTIONS[value];
            const checked = value === resolved;

            return (
              <DropdownMenuItem
                aria-checked={checked}
                data-state={checked ? 'checked' : 'unchecked'}
                data-testid={`open-pages-in-option-${value}`}
                key={value}
                onSelect={(event) => {
                  // A setting: the host stays open and the check moves.
                  event.preventDefault();
                  setOpenPagesIn(viewId, value);
                }}
                role='menuitemradio'
                style={{ minHeight: MENU.itemHeight, borderRadius: MENU.itemRadius }}
              >
                <Icon aria-hidden='true' className='h-4 w-4' />
                <span className='flex-1 truncate'>{t(labelKey, { defaultValue: defaultLabel })}</span>
                {checked ? <DropdownMenuItemTick data-testid='open-pages-in-check' /> : null}
              </DropdownMenuItem>
            );
          })}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

export default WidgetOpenPagesInRow;

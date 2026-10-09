import { forwardRef, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DASHBOARD_GEOMETRY } from '@/application/database-yjs/dashboard-geometry';
import { ReactComponent as OpenIcon } from '@/assets/icons/arrow_up_right.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { DRILL, DRILL_TOOL_STYLE } from './drillStyles';
import { SaveAsViewPopover } from './SaveAsViewPopover';

const MENU = DASHBOARD_GEOMETRY.menu;
const ITEM_STYLE = { minHeight: MENU.itemHeight, height: MENU.itemHeight, borderRadius: MENU.itemRadius };

const MoreButton = forwardRef<HTMLButtonElement, React.ComponentProps<'button'>>(function MoreButton(props, ref) {
  const { t } = useTranslation();
  const label = t('chart.drilldown.more', { defaultValue: 'More' });

  return (
    <button
      {...props}
      aria-label={label}
      className={cn(
        'flex shrink-0 items-center justify-center rounded-200 text-icon-secondary',
        'hover:bg-fill-content-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-theme-thick',
        'data-[state=open]:bg-fill-content-hover [&_svg]:h-4 [&_svg]:w-4'
      )}
      data-parity-id='dash-drilldown-more'
      data-testid='chart-drilldown-more'
      ref={ref}
      style={DRILL_TOOL_STYLE}
      title={label}
      type='button'
    >
      <MoreIcon aria-hidden='true' data-parity-id='dash-drilldown-more__icon' />
    </button>
  );
});

export interface DrillMoreMenuProps {
  /** Writers of the source database: "Save as view…" is offered. */
  canSaveView: boolean;
  /** The row-set fallback: "Save as view…" is disabled with a tooltip. */
  saveDisabled: boolean;
  /** The source database's name ("Open {database}"). */
  databaseName: string;
  onOpenDatabase: () => void;
  defaultViewName: string;
  onSaveView: (name: string) => Promise<unknown>;
}

/**
 * The drill-down `···` menu (WP13 §3.7): "Save as view…" for writers (its
 * name prompt hangs from the same button) and "Open {database}" for everyone.
 * Published pages render no menu at all.
 */
export function DrillMoreMenu({
  canSaveView,
  saveDisabled,
  databaseName,
  onOpenDatabase,
  defaultViewName,
  onSaveView,
}: DrillMoreMenuProps) {
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const opensPromptRef = useRef(false);
  const saveLabel = t('chart.drilldown.saveAsView', { defaultValue: 'Save as view…' });
  const saveItem = (
    <DropdownMenuItem
      data-testid='drill-menu-save-as-view'
      disabled={saveDisabled}
      onSelect={() => {
        opensPromptRef.current = true;
        setSaveOpen(true);
      }}
      style={ITEM_STYLE}
    >
      <PlusIcon aria-hidden='true' />
      {saveLabel}
    </DropdownMenuItem>
  );

  return (
    <SaveAsViewPopover
      anchor={
        <span className='inline-flex'>
          <DropdownMenu modal={false} onOpenChange={setMenuOpen} open={menuOpen}>
            <DropdownMenuTrigger asChild>
              <MoreButton />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align='end'
              className='min-w-0'
              data-testid='drill-more-menu'
              onCloseAutoFocus={(event) => {
                // The name prompt takes the focus.
                if (opensPromptRef.current) {
                  opensPromptRef.current = false;
                  event.preventDefault();
                }
              }}
              style={{ width: DRILL.menuWidth, borderRadius: MENU.radius, padding: MENU.padding }}
            >
              {canSaveView ? (
                saveDisabled ? (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <div data-testid='drill-menu-save-as-view-disabled'>{saveItem}</div>
                    </TooltipTrigger>
                    <TooltipContent side='left'>
                      {t('chart.drilldown.cannotSaveSelectedRows', {
                        defaultValue: "Selected rows can't be saved as a view",
                      })}
                    </TooltipContent>
                  </Tooltip>
                ) : (
                  saveItem
                )
              ) : null}
              <DropdownMenuItem data-testid='drill-menu-open-database' onSelect={onOpenDatabase} style={ITEM_STYLE}>
                <OpenIcon aria-hidden='true' />
                <span className='truncate'>
                  {t('chart.drilldown.openDatabase', { database: databaseName, defaultValue: 'Open {{database}}' })}
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </span>
      }
      defaultName={defaultViewName}
      onOpenChange={setSaveOpen}
      onSave={onSaveView}
      open={saveOpen}
    />
  );
}

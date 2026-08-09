import { useTranslation } from 'react-i18next';

import { useBoardLayoutSettings } from '@/application/database-yjs';
import { useToggleCollapsedHiddenGroupColumnDispatch } from '@/application/database-yjs/dispatch';
import { ReactComponent as CollapseIcon } from '@/assets/icons/arrow_left_line.svg';
import { ReactComponent as ExpandIcon } from '@/assets/icons/menu.svg';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

function HiddenGroupColumnHeader () {
  const {
    isCollapsed,
  } = useBoardLayoutSettings();

  const onToggleCollapse = useToggleCollapsedHiddenGroupColumnDispatch();

  const { t } = useTranslation();

  return (
    <div
      style={{
        width: isCollapsed ? '32px' : '240px',
      }}
      className={'flex font-medium text-sm mt-2 h-[26px] text-text-secondary items-center gap-2 justify-between'}
    >
      {!isCollapsed && t('board.hiddenGroupSection.sectionTitle')}
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            data-testid={'board-hidden-groups-toggle'}
            aria-expanded={!isCollapsed}
            aria-label={isCollapsed
              ? t('board.hiddenGroupSection.expandTooltip')
              : t('board.hiddenGroupSection.collapseTooltip')}
            onClick={() => {
              onToggleCollapse(!isCollapsed);
            }}
            variant={'ghost'}
            size={'icon-sm'}
          >
            {isCollapsed ? <ExpandIcon className={'w-5 h-5'} /> : <CollapseIcon className={'w-5 h-5'} />}

          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {isCollapsed ? t('board.hiddenGroupSection.expandTooltip') : t('board.hiddenGroupSection.collapseTooltip')}
        </TooltipContent>
      </Tooltip>

    </div>
  );
}

export default HiddenGroupColumnHeader;

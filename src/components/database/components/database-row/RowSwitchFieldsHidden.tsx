import { useTranslation } from 'react-i18next';

import { ReactComponent as DownIcon } from '@/assets/icons/alt_arrow_down.svg';
import { cn } from '@/lib/utils';

function RowSwitchFieldsHidden({
  onToggleSwitchFieldsHidden,
  isFilterHidden,
  hideCount,
  templateStyle = false,
}: {
  hideCount: number;
  isFilterHidden: boolean;
  onToggleSwitchFieldsHidden: () => void;
  templateStyle?: boolean;
}) {
  const { t } = useTranslation();
  const handleClick = () => {
    onToggleSwitchFieldsHidden();
  };

  if (hideCount === 0) return null;
  return (
    <button
      type='button'
      onClick={handleClick}
      className={cn(
        'mx-6 flex h-[36px] cursor-pointer items-center gap-1.5 rounded-300 bg-fill-content px-1 py-2 text-sm font-medium text-text-secondary hover:bg-fill-content-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-text-action',
        templateStyle && 'mx-1 h-[30px] w-fit bg-transparent py-1.5 font-normal text-text-tertiary'
      )}
    >
      <DownIcon className={cn('h-5 w-5 text-text-secondary', 'transform', !isFilterHidden && 'rotate-180')} />
      {isFilterHidden
        ? t('grid.rowPage.showHiddenFields', {
            count: hideCount,
          })
        : t('grid.rowPage.hideHiddenFields', {
            count: hideCount,
          })}
    </button>
  );
}

export default RowSwitchFieldsHidden;

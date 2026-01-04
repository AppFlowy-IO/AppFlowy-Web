import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Sort } from '@/application/database-yjs';
import { ReactComponent as ArrowDownSvg } from '@/assets/icons/alt_arrow_down.svg';
import ConditionMenu from '@/components/database/components/sorts/ConditionMenu';
import { Button } from '@/components/ui/button';

function SortCondition ({ sort }: { sort: Sort }) {
  const condition = sort.condition;
  const { t } = useTranslation();
  const conditionText = useMemo(() => {
    switch (condition) {
      case 0:
        return t('grid.sort.ascending');
      case 1:
        return t('grid.sort.descending');
    }
  }, [condition, t]);

  const [open, setOpen] = useState(false);

  return (
    <Button
      data-testid="sort-condition-button"
      variant={'outline'}
      size={'sm'}
      onClick={() => {
        setOpen(!open);
      }}
      className={
        'rounded-full w-[140px] justify-start overflow-hidden relative'
      }
    >
      <span className={'truncate'}>{conditionText}</span>
      <ArrowDownSvg className={'text-text-secondary ml-auto w-5 h-5'} />
      {open && (
        <ConditionMenu
          sortId={sort.id}
          open={open}
          onOpenChange={setOpen}
          selected={sort.condition}
        />
      )}
    </Button>
  );
}

export default SortCondition;

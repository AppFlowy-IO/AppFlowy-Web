import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Sort, SortCondition as SortDirection } from '@/application/database-yjs';
import { ReactComponent as ArrowDownSvg } from '@/assets/icons/alt_arrow_down.svg';
import ConditionMenu from '@/components/database/components/sorts/ConditionMenu';
import { Button } from '@/components/ui/button';

function SortCondition({ sort, onChange, disabled }: { sort: Sort; onChange?: (condition: SortDirection) => void; disabled?: boolean }) {
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
      disabled={disabled}
      variant={'outline'}
      size={'sm'}
      onClick={() => {
        setOpen(!open);
      }}
      className={'relative w-[140px] justify-start overflow-hidden rounded-full'}
    >
      <span className={'truncate'}>{conditionText}</span>
      <ArrowDownSvg className={'ml-auto h-5 w-5 text-text-secondary'} />
      {open && (
        <ConditionMenu
          sortId={sort.id}
          open={open}
          onOpenChange={setOpen}
          selected={sort.condition}
          onSelect={onChange}
        />
      )}
    </Button>
  );
}

export default SortCondition;

import { Sort } from '@/application/database-yjs';
import ConditionMenu from '@/components/database/components/sorts/ConditionMenu';
import { Button } from '@/components/ui/button';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ReactComponent as ArrowDownSvg } from '@/assets/icons/alt_arrow_down.svg';

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
      variant={'outline'}
      size={'sm'}
      onClick={() => {
        setOpen(!open);
      }}
      className={
        'max-w-[250px] rounded-full min-w-[120px] overflow-hidden relative'
      }
    >
      {conditionText}
      <ArrowDownSvg className={'text-text-caption w-5 h-5'} />
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

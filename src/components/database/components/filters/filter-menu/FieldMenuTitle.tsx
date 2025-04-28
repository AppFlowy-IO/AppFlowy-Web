import { ReactComponent as ArrowDownSvg } from '@/assets/icons/alt_arrow_left.svg';
import { FieldDisplay } from '@/components/database/components/field';
import React from 'react';

function FieldMenuTitle ({ fieldId, selectedConditionText }: { fieldId: string; selectedConditionText: string }) {
  return (
    <div className={'flex items-center justify-between gap-2'}>
      <div className={'w-[80px] max-w-[180px] overflow-hidden'}>
        <FieldDisplay
          fieldId={fieldId}
          className={'text-xs text-text-primary gap-1.5'}
        />
      </div>
      <div className={'flex flex-1 items-center justify-end'}>
        <div className={'flex items-center gap-1'}>
          <div
            data-testid={'filter-condition-type'}
            className={'overflow max-w-[100px] truncate whitespace-nowrap text-xs font-normal'}
          >
            {selectedConditionText}
          </div>
          <ArrowDownSvg />
        </div>
      </div>
    </div>
  );
}

export default FieldMenuTitle;

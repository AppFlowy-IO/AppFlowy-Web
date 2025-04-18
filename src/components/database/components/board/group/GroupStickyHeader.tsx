import { GroupColumn, Row, useDatabaseContext } from '@/application/database-yjs';
import GroupHeader from '@/components/database/components/board/group/GroupHeader';
import React, { forwardRef } from 'react';

const GroupStickyHeader = forwardRef<HTMLDivElement, {
  columns: GroupColumn[];
  fieldId: string;
  groupResult: Map<string, Row[]>
  onScrollLeft: (left: number) => void,
}>(({
  columns,
  fieldId,
  groupResult,
  onScrollLeft,
}, ref) => {
  const context = useDatabaseContext();
  const {
    paddingStart,
    paddingEnd,
  } = context;

  return (
    <div
      ref={ref}
      style={{
        paddingLeft: paddingStart,
        paddingRight: paddingEnd,
      }}
      onScroll={e => {
        const scrollLeft = e.currentTarget.scrollLeft;

        onScrollLeft(scrollLeft);
      }}
      className={'max-sm:!px-6 pb-1 px-24 appflowy-custom-scroller bg-background-primary overflow-x-auto h-full'}
    >
      <GroupHeader
        columns={columns}
        fieldId={fieldId}
        groupResult={groupResult}
      />
    </div>

  );
});

export default GroupStickyHeader;
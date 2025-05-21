import { useDatabaseContext, useRowPrimaryContentSelector } from '@/application/database-yjs';
import { YDoc } from '@/application/types';
import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

function RelationRowItem ({ rowId, rowKey, primaryFieldId }: {
  rowId: string,
  rowKey: string;
  primaryFieldId: string
}) {
  const context = useDatabaseContext();
  const createRowDoc = context.createRowDoc;
  const [rowDoc, setRowDoc] = useState<YDoc | null>(null);

  const { t } = useTranslation();
  const content = useRowPrimaryContentSelector(rowDoc, primaryFieldId);

  useEffect(() => {
    void (async () => {
      if (!rowKey || !createRowDoc) return;
      const rowDoc = await createRowDoc(rowKey);

      setRowDoc(rowDoc);
    })();
  }, [createRowDoc, rowKey]);

  return (
    <div
      data-row-id={rowId}
      style={{
        scrollMarginTop: '80px',
      }}
      className={'text-sm w-full text-text-primary'}
    >
      {content || t('menuAppHeader.defaultNewPageName')}
    </div>
  );
}

export default RelationRowItem;
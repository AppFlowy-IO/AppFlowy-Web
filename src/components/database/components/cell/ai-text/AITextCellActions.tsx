import { FieldType, useDatabase, useDatabaseContext, useFieldSelector, useRowData } from '@/application/database-yjs';
import { AICell } from '@/application/database-yjs/cell.type';
import { useUpdateCellDispatch } from '@/application/database-yjs/dispatch';
import { GenerateAISummaryRowPayload, GenerateAITranslateRowPayload, YjsDatabaseKey } from '@/application/types';
import { ReactComponent as AIIcon } from '@/assets/icons/ai_improve_writing.svg';
import { ReactComponent as CopyIcon } from '@/assets/icons/copy.svg';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { copyTextToClipboard } from '@/utils/copy';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

function AITextCellActions ({ cell, fieldId, rowId }: {
  cell?: AICell;
  fieldId: string;
  rowId: string;
}) {
  const { t, i18n } = useTranslation();
  const handleCopy = () => {
    if (!cell?.data) return;
    void copyTextToClipboard(cell?.data);
    toast.success(t('grid.url.copiedNotification'));
  };

  const database = useDatabase();
  const fields = database.get(YjsDatabaseKey.fields);
  const { field } = useFieldSelector(fieldId);
  const type = Number(field?.get(YjsDatabaseKey.type)) as FieldType;
  const row = useRowData(rowId);
  const updateCell = useUpdateCellDispatch(rowId, fieldId);
  const [loading, setLoading] = useState(false);
  const {
    generateAITranslateForRow,
    generateAISummaryForRow,
  } = useDatabaseContext();

  const handleGenerateSummary = async () => {
    const cells = row.get(YjsDatabaseKey.cells);
    const fieldIds = Array.from(cells.keys());

    const data = {};

    fieldIds.forEach((fieldId) => {
      const cell = cells.get(fieldId);
      const type = Number(cell?.get(YjsDatabaseKey.field_type));

      const fieldName = fields.get(fieldId)?.get(YjsDatabaseKey.name) || '';

      if (cell && fieldName && ![
        FieldType.AISummaries,
        FieldType.AITranslations,
      ].includes(type)) {
        Object.assign(data, {
          [fieldName]: cell.get(YjsDatabaseKey.data).toString() || '',
        });
      }
    });
    const result = await generateAISummaryForRow?.({
      Content: data,
    });

    if (result) {
      updateCell(result);
    }

  };

  const handleGenerateAITranslate = async () => {
    const cells = row.get(YjsDatabaseKey.cells);
    const cellValues: GenerateAITranslateRowPayload['cells'] = [];

    const fieldIds = Array.from(cells.keys());

    fieldIds.forEach((fieldId) => {
      const cell = cells.get(fieldId);
      const type = Number(cell?.get(YjsDatabaseKey.field_type));

      const fieldName = fields.get(fieldId)?.get(YjsDatabaseKey.name) || '';

      if (cell && fieldName && ![
        FieldType.AISummaries,
        FieldType.AITranslations,
      ].includes(type)) {
        cellValues.push({
          content: cell.get(YjsDatabaseKey.data).toString() || '',
          title: fieldName,
        });
      }
    });

    const result = await generateAITranslateForRow?.({
      cells: cellValues,
      language: i18n.language,
      include_header: false,
    });

    if (result) {
      updateCell(result);
    }
  };

  const handleGenerate = async () => {
    setLoading(true);
    try {
      if (type === FieldType.AISummaries) {
        await handleGenerateSummary();
      } else {
        await handleGenerateAITranslate();
      }
      // eslint-disable-next-line
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }

  };

  return (
    <div
      onClick={e => {
        e.stopPropagation();
      }}
      className={'absolute flex items-center gap-1 right-1 top-1'}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant={'outline'}
            size={'icon'}
            loading={loading}
            onClick={handleGenerate}
            className={'bg-surface-primary hover:text-text-featured hover:border-border-featured-thick hover:bg-surface-primary-hover'}
          >
            {loading ? <Progress variant={'primary'} /> : <AIIcon className={'w-5 h-5'} />}

          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {t('tooltip.aiGenerate')}
        </TooltipContent>
      </Tooltip>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            onClick={handleCopy}
            variant={'outline'}
            size={'icon'}
            className={'bg-surface-primary hover:bg-surface-primary-hover'}

          >
            <CopyIcon className={'w-5 h-5'} />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {t('settings.menu.clickToCopy')}
        </TooltipContent>
      </Tooltip>

    </div>
  );
}

export default AITextCellActions;
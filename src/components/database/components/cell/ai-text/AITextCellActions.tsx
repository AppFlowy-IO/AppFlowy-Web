import { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import {
  FieldType,
  getRowTimeString,
  useDatabase,
  useDatabaseContext,
  useFieldSelector,
  useRowData,
} from '@/application/database-yjs';
import { getCellDataText } from '@/application/database-yjs/cell.parse';
import { AICell } from '@/application/database-yjs/cell.type';
import { useUpdateCellDispatch } from '@/application/database-yjs/dispatch';
import { languageTexts, parseAITranslateTypeOption } from '@/application/database-yjs/fields/ai-translate';
import { GenerateAITranslateRowPayload, YDatabaseCell, YDatabaseField, YjsDatabaseKey } from '@/application/types';
import { ReactComponent as AIIcon } from '@/assets/icons/ai_improve_writing.svg';
import { ReactComponent as CopyIcon } from '@/assets/icons/copy.svg';
import { useCurrentUser } from '@/components/main/app.hooks';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { copyTextToClipboard } from '@/utils/copy';

function AITextCellActions({
  cell,
  fieldId,
  rowId,
  loading,
  setLoading,
}: {
  cell?: AICell;
  fieldId: string;
  rowId: string;
  loading: boolean;
  setLoading: (value: boolean) => void;
}) {
  const { t } = useTranslation();
  const { field, clock } = useFieldSelector(fieldId);

  const language = useMemo(() => {
    const lang = parseAITranslateTypeOption(field).language;

    return languageTexts.find((option) => option.value === lang)?.label || languageTexts[0].label;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field, clock]);

  const handleCopy = () => {
    if (!cell?.data) return;
    void copyTextToClipboard(cell?.data);
    toast.success(t('grid.url.copiedNotification'));
  };

  const database = useDatabase();
  const type = Number(field?.get(YjsDatabaseKey.type)) as FieldType;
  const row = useRowData(rowId);
  const updateCell = useUpdateCellDispatch(rowId, fieldId);
  const { generateAITranslateForRow, generateAISummaryForRow } = useDatabaseContext();
  const currentUser = useCurrentUser();

  const getCellData = useCallback(
    (cell: YDatabaseCell, field: YDatabaseField) => {
      if (!currentUser) return '';
      const type = Number(field?.get(YjsDatabaseKey.type));

      if (type === FieldType.CreatedTime) {
        return getRowTimeString(field, row.get(YjsDatabaseKey.created_at), currentUser) || '';
      } else if (type === FieldType.LastEditedTime) {
        return getRowTimeString(field, row.get(YjsDatabaseKey.last_modified), currentUser) || '';
      } else if (cell && ![FieldType.AISummaries, FieldType.AITranslations].includes(type)) {
        try {
          return getCellDataText(cell, field, currentUser);
        } catch (e) {
          console.error(e);
          return '';
        }
      }

      return '';
    },
    [currentUser, row]
  );

  const handleGenerateSummary = useCallback(async () => {
    const cells = row.get(YjsDatabaseKey.cells);
    const fields = database.get(YjsDatabaseKey.fields);
    const fieldIds = Array.from(fields.keys());

    const data = {};

    fieldIds.forEach((fieldId) => {
      const cell = cells.get(fieldId);
      const field = fields.get(fieldId);

      if (!field) return;

      const fieldName = field.get(YjsDatabaseKey.name) || '';

      if (fieldName) {
        Object.assign(data, {
          [fieldName]: getCellData(cell, field),
        });
      }
    });
    const result = await generateAISummaryForRow?.({
      Content: data,
    });

    if (result) {
      updateCell(result);
    }
  }, [row, generateAISummaryForRow, getCellData, updateCell, database]);

  const handleGenerateAITranslate = useCallback(async () => {
    const cells = row.get(YjsDatabaseKey.cells);
    const cellValues: GenerateAITranslateRowPayload['cells'] = [];
    const fields = database.get(YjsDatabaseKey.fields);

    const fieldIds = Array.from(fields.keys());

    fieldIds.forEach((fieldId) => {
      const cell = cells.get(fieldId);
      const field = fields.get(fieldId);

      const fieldName = field?.get(YjsDatabaseKey.name) || '';

      if (fieldName) {
        cellValues.push({
          content: getCellData(cell, field),
          title: fieldName,
        });
      }
    });

    const result = await generateAITranslateForRow?.({
      cells: cellValues,
      language,
      include_header: false,
    });

    if (result) {
      updateCell(result);
    }
  }, [getCellData, database, row, updateCell, language, generateAITranslateForRow]);

  const loadingRef = useRef(false);

  const handleGenerate = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
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
      loadingRef.current = false;
      setLoading(false);
    }
  }, [setLoading, type, handleGenerateSummary, handleGenerateAITranslate]);

  return (
    <div
      data-testid={`ai-cell-actions-${rowId}-${fieldId}`}
      onClick={(e) => {
        e.stopPropagation();
      }}
      className={'absolute right-1 top-1 flex items-center gap-1'}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            data-testid={`ai-generate-button-${rowId}-${fieldId}`}
            variant={'outline'}
            size={'icon'}
            onClick={handleGenerate}
            className={
              'bg-surface-primary hover:border-border-featured-thick hover:bg-surface-primary-hover hover:text-text-featured'
            }
          >
            {loading ? <Progress variant={'primary'} /> : <AIIcon className={'h-5 w-5'} />}
          </Button>
        </TooltipTrigger>
        <TooltipContent>{t('tooltip.aiGenerate')}</TooltipContent>
      </Tooltip>

      {loading ? null : (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              data-testid={`ai-copy-button-${rowId}-${fieldId}`}
              onClick={handleCopy}
              variant={'outline'}
              size={'icon'}
              className={'bg-surface-primary hover:bg-surface-primary-hover'}
            >
              <CopyIcon className={'h-5 w-5'} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('settings.menu.clickToCopy')}</TooltipContent>
        </Tooltip>
      )}
    </div>
  );
}

export default AITextCellActions;

import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useDatabaseFields } from '@/application/database-yjs/context';
import { CalculationType } from '@/application/database-yjs/database.type';
import { useUpdateFormulaTypeOption } from '@/application/database-yjs/dispatch';
import {
  parseFormulaTypeOption,
  parseFormulaVisualizationOption,
  readFormulaSchemaForVersion,
  toDisplayExpression,
} from '@/application/database-yjs/fields/formula';
import { formats } from '@/application/database-yjs/fields/number/format';
import { useDatabaseFieldsVersion } from '@/application/database-yjs/hooks/useDatabaseFieldsVersion';
import { useFieldSelector, useFormulaResultType } from '@/application/database-yjs/selector';
import { ReactComponent as FormulaIcon } from '@/assets/icons/formula.svg';
import { RollupVisualizationSettings } from '@/components/database/components/property/rollup/RollupVisualizationSettings';
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuItemTick,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { SearchInput } from '@/components/ui/search-input';

export function FormulaPropertyMenuContent({
  fieldId,
  onRequestEditor,
}: {
  fieldId: string;
  /** Opens the formula editor; the host closes this menu first. */
  onRequestEditor: () => void;
}) {
  const { t } = useTranslation();
  const { field, clock } = useFieldSelector(fieldId);
  const fields = useDatabaseFields();
  const resultType = useFormulaResultType(fieldId);
  const updateFormulaTypeOption = useUpdateFormulaTypeOption(fieldId);
  // The field map keeps its identity across edits; `clock` re-reads it after a change.
  const typeOption = useMemo(() => {
    void clock;
    return field ? parseFormulaTypeOption(field) : null;
  }, [field, clock]);
  // Referenced properties can be renamed while the menu is open.
  const fieldsVersion = useDatabaseFieldsVersion();
  const expressionPreview = useMemo(
    () => (typeOption ? toDisplayExpression(typeOption.formula, readFormulaSchemaForVersion(fields, fieldsVersion)) : ''),
    [typeOption, fields, fieldsVersion]
  );
  const [formatSearch, setFormatSearch] = useState('');
  const [formatOpen, setFormatOpen] = useState(false);
  const selectedFormat = formats.find((item) => item.value === typeOption?.format);
  const filteredFormats = formats.filter((item) => item.label.toLowerCase().includes(formatSearch.toLowerCase()));
  const isNumber = resultType === 'number';

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuLabel>{t('grid.formula.title', { defaultValue: 'Formula' })}</DropdownMenuLabel>
        <DropdownMenuItem
          data-testid={'formula-edit-formula'}
          onSelect={(event) => {
            event.preventDefault();
            onRequestEditor();
          }}
        >
          <FormulaIcon className={'h-5 w-5 shrink-0'} />
          <span className={'truncate'}>
            {expressionPreview.trim()
              ? expressionPreview
              : t('grid.formula.editFormula', { defaultValue: 'Edit formula' })}
          </span>
        </DropdownMenuItem>
      </DropdownMenuGroup>

      {isNumber && typeOption ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuGroup>
            <DropdownMenuLabel>{t('grid.field.numberFormat')}</DropdownMenuLabel>
            <DropdownMenuSub open={formatOpen} onOpenChange={setFormatOpen}>
              <DropdownMenuSubTrigger
                data-testid={'formula-number-format'}
                {...(formatOpen && {
                  onPointerMove: (e) => e.preventDefault(),
                  onPointerLeave: (e) => e.preventDefault(),
                })}
              >
                {selectedFormat?.label}
              </DropdownMenuSubTrigger>
              <DropdownMenuPortal>
                <DropdownMenuSubContent className={'appflowy-scroller max-h-[450px] max-w-[240px] overflow-y-auto pt-0'}>
                  <div className={'sticky top-0 z-[1] flex flex-col bg-surface-primary pt-2'}>
                    <SearchInput
                      data-testid={'formula-number-format-search'}
                      placeholder={t('searchLabel')}
                      value={formatSearch}
                      onChange={(event) => setFormatSearch(event.target.value)}
                      onKeyDown={(event) => event.stopPropagation()}
                    />
                    <DropdownMenuSeparator />
                  </div>
                  {filteredFormats.map((item) => (
                    <DropdownMenuItem
                      key={item.value}
                      data-testid={`formula-number-format-${item.value}`}
                      onSelect={() => {
                        updateFormulaTypeOption({ format: item.value });
                        setFormatOpen(false);
                      }}
                    >
                      {item.label}
                      {item.value === typeOption.format ? <DropdownMenuItemTick /> : null}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuSubContent>
              </DropdownMenuPortal>
            </DropdownMenuSub>
          </DropdownMenuGroup>
          <RollupVisualizationSettings
            option={parseFormulaVisualizationOption(typeOption)}
            calculationType={CalculationType.Count}
            onChange={(updates) =>
              updateFormulaTypeOption({
                ...(updates.type !== undefined ? { visualization_type: updates.type } : {}),
                ...(updates.color !== undefined ? { visualization_color: updates.color } : {}),
                ...(updates.divisor !== undefined ? { visualization_divisor: updates.divisor } : {}),
                ...(updates.showNumber !== undefined ? { visualization_show_number: updates.showNumber } : {}),
              })
            }
          />
        </>
      ) : null}
    </>
  );
}

export default FormulaPropertyMenuContent;

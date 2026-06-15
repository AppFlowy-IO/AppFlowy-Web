import { IconButton, PopoverPosition, TextField, Tooltip } from '@mui/material';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as Clear } from '@/assets/icons/delete.svg';
import { ReactComponent as SelectCheck } from '@/assets/icons/tick.svg';
import { Popover } from '@/components/_shared/popover';

function FormulaPopover({
  open,
  onClose,
  defaultValue,
  anchorPosition,
  onDone,
  onClear,
}: {
  open: boolean;
  onClose: () => void;
  defaultValue: string;
  anchorPosition?: PopoverPosition;
  onDone: (value: string) => void;
  onClear: () => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = React.useState(defaultValue);

  return (
    <Popover
      onClose={onClose}
      open={open}
      disableRestoreFocus={true}
      anchorPosition={anchorPosition}
      anchorReference={'anchorPosition'}
      transformOrigin={{
        vertical: 'top',
        horizontal: 'left',
      }}
    >
      <div className={'flex items-center gap-2 p-4'}>
        <TextField
          variant={'standard'}
          size={'small'}
          autoFocus={true}
          value={value}
          spellCheck={false}
          placeholder={'E = mc^2'}
          onClick={(e) => {
            if (e.detail > 2) {
              e.preventDefault();
              const target = e.target as HTMLInputElement;

              // select all text on triple click
              target.setSelectionRange(0, target.value.length);
            }
          }}
          onChange={(e) => setValue(e.target.value)}
          fullWidth={true}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onDone(value);
            }
          }}
        />
        <div className={'flex items-center justify-end gap-2'}>
          <Tooltip placement={'top'} title={t('button.done')}>
            <IconButton
              size={'small'}
              onClick={() => {
                onDone(value);
              }}
            >
              <SelectCheck className={'text-text-action'} />
            </IconButton>
          </Tooltip>
          <Tooltip placement={'top'} title={t('button.clear')}>
            <IconButton size={'small'} color={'error'} onClick={onClear}>
              <Clear />
            </IconButton>
          </Tooltip>
        </div>
      </div>
    </Popover>
  );
}

export default FormulaPopover;

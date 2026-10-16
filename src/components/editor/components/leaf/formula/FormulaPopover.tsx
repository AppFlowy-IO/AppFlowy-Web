import { PopoverPosition } from '@mui/material';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Popover } from '@/components/_shared/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

function FormulaPopover({
  open,
  onClose,
  defaultValue,
  anchorPosition,
  onDone,
  onPreview,
}: {
  open: boolean;
  onClose: () => void;
  defaultValue: string;
  anchorPosition?: PopoverPosition;
  onDone: (value: string) => void;
  onPreview?: (value: string) => void;
}) {
  const { t } = useTranslation();
  const [value, setValue] = useState(defaultValue);

  return (
    <Popover
      onClose={onClose}
      open={open}
      PaperProps={{ className: '!rounded-xl !border !border-border-primary !bg-surface-primary !shadow-menu' }}
      disableRestoreFocus
      anchorPosition={anchorPosition}
      anchorReference='anchorPosition'
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
    >
      <div
        className='flex w-[331px] max-w-[calc(100vw-32px)] items-center gap-2 p-2'
        data-testid='inline-equation-editor'
      >
        <Input
          aria-label={t('document.plugins.mathEquation.inline')}
          autoFocus
          value={value}
          spellCheck={false}
          placeholder='E = mc^2'
          className='h-8 min-w-0 flex-1 px-2 py-1.5'
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => {
            setValue(event.target.value);
            onPreview?.(event.target.value);
          }}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.nativeEvent.isComposing) return;
            if (event.key === 'Enter') {
              event.preventDefault();
              onDone(value);
            }

            if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            }
          }}
        />
        <Button onClick={() => onDone(value)}>{t('button.done')}</Button>
      </div>
    </Popover>
  );
}

export default FormulaPopover;

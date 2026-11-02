import { FormEvent, ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DASHBOARD_GEOMETRY } from '@/application/database-yjs/dashboard-geometry';
import { Button } from '@/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';

import { DRILL } from './drillStyles';

/**
 * The "Save as view…" name prompt (WP13 §3.7), anchored to `···`: "View
 * name", an input prefilled with the default name and selected, Cancel and
 * Save. Enter saves, Esc cancels.
 */
export function SaveAsViewPopover({
  open,
  onOpenChange,
  defaultName,
  onSave,
  anchor,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultName: string;
  /** Resolves once the view is saved (the drill-down closes) or failed. */
  onSave: (name: string) => Promise<unknown>;
  /** The `···` button the prompt hangs from. */
  anchor: ReactNode;
}) {
  const { t } = useTranslation();
  const [name, setName] = useState(defaultName);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setName(defaultName);
    setSaving(false);
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });

    return () => cancelAnimationFrame(frame);
  }, [open, defaultName]);

  const trimmed = name.trim();
  const submit = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      await onSave(trimmed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover onOpenChange={onOpenChange} open={open}>
      <PopoverAnchor asChild>{anchor}</PopoverAnchor>
      <PopoverContent
        align='end'
        className='min-w-0 bg-surface-primary p-3'
        data-testid='drill-save-view-popover'
        onClick={(event) => event.stopPropagation()}
        onCloseAutoFocus={(event) => event.preventDefault()}
        style={{ width: DRILL.savePopoverWidth, borderRadius: DASHBOARD_GEOMETRY.popover.radius }}
      >
        <form className='flex flex-col gap-2' onSubmit={(event) => void submit(event)}>
          <label className='text-xs font-medium text-text-secondary' htmlFor='drill-save-view-name'>
            {t('dashboard.picker.viewName', { defaultValue: 'View name' })}
          </label>
          <input
            className='h-8 rounded-200 border border-border-primary bg-fill-content px-2 text-sm text-text-primary outline-none focus:border-border-theme-thick'
            data-testid='drill-save-view-name'
            id='drill-save-view-name'
            onChange={(event) => setName(event.target.value)}
            ref={inputRef}
            value={name}
          />
          <div className='flex justify-end gap-2'>
            <Button
              data-testid='drill-save-view-cancel'
              onClick={() => onOpenChange(false)}
              size='sm'
              type='button'
              variant='ghost'
            >
              {t('button.cancel', { defaultValue: 'Cancel' })}
            </Button>
            <Button data-testid='drill-save-view-save' disabled={!trimmed} loading={saving} size='sm' type='submit'>
              {t('button.save', { defaultValue: 'Save' })}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

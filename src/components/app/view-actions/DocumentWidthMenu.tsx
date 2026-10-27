import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DocumentWidth, MAX_DOCUMENT_WIDTH, MIN_DOCUMENT_WIDTH, parseDocumentWidth } from '@/application/document-width';
import { ViewService } from '@/application/services/domains';
import { View } from '@/application/types';
import { findView } from '@/components/_shared/outline/utils';
import { useAppOperations } from '@/components/app/app.hooks';
import { Button } from '@/components/ui/button';
import {
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';

export function DocumentWidthMenu({ view, workspaceId, disabled, onSaved }: {
  view: View;
  workspaceId: string;
  disabled: boolean;
  onSaved?: () => void;
}) {
  const { t } = useTranslation();
  const { updatePage } = useAppOperations();
  const width = parseDocumentWidth(view.extra?.document_width);
  const [open, setOpen] = useState(false);
  const [customWidth, setCustomWidth] = useState('960');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const pending = useRef(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  const save = async (nextWidth: DocumentWidth | undefined) => {
    if (pending.current || disabled || !workspaceId || !updatePage) return;
    pending.current = true;
    setSaving(true);
    setError(undefined);
    try {
      // Preserve metadata edited since the menu opened, including unknown keys.
      const navigation = await ViewService.getNavigation(workspaceId, view.view_id, 0);
      // Navigation is an ancestor tree, including spaces and siblings. Merge
      // only the target page's metadata into the page being updated.
      const latest = findView([navigation], view.view_id);

      if (!latest) throw new Error('Page missing from navigation');

      const extra = { ...latest.extra };

      // Legacy page extras may include is_space:false. The page update API
      // accepts space metadata only for actual spaces.
      if (!(latest.is_space ?? extra.is_space)) {
        delete extra.is_space;
        delete extra.space_permission;
      }

      if (nextWidth) extra.document_width = nextWidth;
      else delete extra.document_width;
      await updatePage(view.view_id, { name: latest.name, extra });
      if (mounted.current) {
        setOpen(false);
        onSaved?.();
      }
    } catch {
      if (mounted.current) setError(t('document.width.saveError'));
    } finally {
      pending.current = false;
      if (mounted.current) setSaving(false);
    }
  };

  return (
    <DropdownMenuSub open={open} onOpenChange={(next) => {
      if (saving) return;
      if (next) {
        setCustomWidth(String(width?.mode === 'fixed' ? width.max_width : 960));
        setError(undefined);
      }

      setOpen(next);
    }}>
      <DropdownMenuSubTrigger data-testid='document-width-action' disabled={disabled || !updatePage}>
        {t('document.width.title')}
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent data-testid='document-width-menu' className='w-[260px]'>
        <DropdownMenuItem data-testid='document-width-default' disabled={saving} onSelect={(event) => {
          event.preventDefault();
          void save(undefined);
        }}>
          {t('document.width.defaultWidth')}
        </DropdownMenuItem>
        <DropdownMenuItem data-testid='document-width-full' disabled={saving} onSelect={(event) => {
          event.preventDefault();
          void save({ mode: 'full' });
        }}>
          {t('document.width.fullWidth')}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <form className='flex flex-col gap-2 p-2' onSubmit={(event) => {
          event.preventDefault();
          const value = Number(customWidth);
          const next = parseDocumentWidth({ mode: 'fixed', max_width: value });

          if (!next) {
            setError(t('document.width.invalidWidth'));
            return;
          }

          void save(next);
        }}>
          <label className='flex flex-col gap-2 text-sm'>
            {t('document.width.customWidth')}
            <Input
              data-testid='document-width-input'
              type='number'
              min={MIN_DOCUMENT_WIDTH}
              max={MAX_DOCUMENT_WIDTH}
              step='any'
              value={customWidth}
              disabled={saving}
              onChange={(event) => setCustomWidth(event.target.value)}
              onKeyDown={(event) => { if (event.key !== 'Escape') event.stopPropagation(); }}
            />
          </label>
          {error && <p role='alert' className='text-sm text-text-error'>{error}</p>}
          <Button type='submit' data-testid='document-width-apply' disabled={saving}>{t('button.apply')}</Button>
        </form>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { TimelineDependencyLink, TimelineDependencyType } from '@/application/database-yjs';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { cn } from '@/lib/utils';

import { TimelineLinkSelection } from './TimelineArrows';

const LINK_TYPES: { value: TimelineDependencyType; short: string; labelKey: string; fallback: string }[] = [
  {
    value: TimelineDependencyType.FinishToStart,
    short: 'FS',
    labelKey: 'timeline.link.finishToStart',
    fallback: 'Finish to start',
  },
  {
    value: TimelineDependencyType.StartToStart,
    short: 'SS',
    labelKey: 'timeline.link.startToStart',
    fallback: 'Start to start',
  },
  {
    value: TimelineDependencyType.FinishToFinish,
    short: 'FF',
    labelKey: 'timeline.link.finishToFinish',
    fallback: 'Finish to finish',
  },
  {
    value: TimelineDependencyType.StartToFinish,
    short: 'SF',
    labelKey: 'timeline.link.startToFinish',
    fallback: 'Start to finish',
  },
];

interface TimelineLinkEditorProps {
  selection: TimelineLinkSelection | null;
  link: TimelineDependencyLink;
  predecessorTitle: string;
  successorTitle: string;
  readOnly: boolean;
  onChange: (link: TimelineDependencyLink) => void;
  onRemove: () => void;
  onClose: () => void;
}

/**
 * Popover opened by clicking a dependency arrow: the link's type (finish /
 * start-to-start / finish), its lag in days (negative = lead) and removal.
 * Anchored at the click point inside the canvas body.
 */
export function TimelineLinkEditor({
  selection,
  link,
  predecessorTitle,
  successorTitle,
  readOnly,
  onChange,
  onRemove,
  onClose,
}: TimelineLinkEditorProps) {
  const { t } = useTranslation();
  const [lagText, setLagText] = useState(String(link.lag));

  useEffect(() => {
    setLagText(String(link.lag));
  }, [link.lag, selection?.predecessorId, selection?.successorId]);

  const commitLag = () => {
    const lag = Math.trunc(Number(lagText));

    if (!Number.isFinite(lag) || lag === link.lag) {
      setLagText(String(link.lag));
      return;
    }

    onChange({ ...link, lag });
  };

  return (
    <Popover open={selection !== null} onOpenChange={(open) => !open && onClose()}>
      <PopoverAnchor asChild>
        <span
          aria-hidden
          className='pointer-events-none absolute h-0 w-0'
          style={{ left: selection?.x ?? 0, top: selection?.y ?? 0 }}
        />
      </PopoverAnchor>
      <PopoverContent
        align='start'
        side='bottom'
        sideOffset={8}
        className='w-[260px] p-3'
        data-testid='timeline-link-editor'
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <div className='mb-2 text-xs text-text-secondary'>
          {t('timeline.link.title', { defaultValue: 'Dependency' })}
        </div>
        <div className='mb-3 truncate text-sm text-text-primary' data-testid='timeline-link-editor-title'>
          {predecessorTitle} → {successorTitle}
        </div>

        <div className='mb-1 text-xs text-text-secondary'>{t('timeline.link.type', { defaultValue: 'Type' })}</div>
        <div className='mb-3 grid grid-cols-4 gap-1' role='radiogroup'>
          {LINK_TYPES.map((option) => (
            <button
              key={option.value}
              type='button'
              role='radio'
              aria-checked={link.type === option.value}
              title={t(option.labelKey, { defaultValue: option.fallback })}
              disabled={readOnly}
              data-testid={`timeline-link-type-${option.value}`}
              className={cn(
                'h-7 rounded-200 border text-xs font-medium',
                link.type === option.value
                  ? 'border-fill-theme-thick bg-fill-theme-select text-text-primary'
                  : 'border-border-primary text-text-secondary hover:bg-fill-content-hover'
              )}
              onClick={() => onChange({ ...link, type: option.value })}
            >
              {option.short}
            </button>
          ))}
        </div>

        <label className='mb-1 block text-xs text-text-secondary' htmlFor='timeline-link-lag'>
          {t('timeline.link.lag', { defaultValue: 'Lag (days)' })}
        </label>
        <Input
          id='timeline-link-lag'
          type='number'
          step={1}
          value={lagText}
          disabled={readOnly}
          data-testid='timeline-link-lag'
          onChange={(event) => setLagText(event.target.value)}
          onBlur={commitLag}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              commitLag();
            }
          }}
        />

        {!readOnly ? (
          <Button
            variant='ghost'
            size='sm'
            className='mt-3 w-full justify-start text-text-error hover:text-text-error'
            data-testid='timeline-link-remove'
            onClick={onRemove}
          >
            <DeleteIcon aria-hidden className='h-4 w-4' />
            {t('timeline.link.remove', { defaultValue: 'Remove dependency' })}
          </Button>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

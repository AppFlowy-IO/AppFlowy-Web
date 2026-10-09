import { KeyboardEvent, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { ReactComponent as InfoIcon } from '@/assets/icons/info.svg';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Log } from '@/utils/log';

/** Marks the field, so the settings host keeps itself open on the Escape that reverts it. */
export const WIDGET_VIEW_NAME_FIELD_ATTR = 'data-widget-view-name-field';

interface WidgetViewNameFieldProps {
  /** The widget title: the view's name. */
  value: string;
  /** Shown while the field is empty (the layout label). */
  placeholder: string;
  /**
   * Rename the view; called with a trimmed, non-empty name that differs from
   * `value`. A result of `false` (nothing was written) or a rejection puts
   * the view's current name back.
   */
  onCommit: (name: string) => void | Promise<unknown>;
  disabled?: boolean;
}

/**
 * The widget name in the settings host header (WP05 §2.2 step 8, spec §7.2):
 * a grey 28px field holding the widget's title, which is its view's name. It
 * renames the view (folder and database, not an undo step): Enter or leaving
 * the field commits, Escape reverts, an empty name changes nothing. The (i)
 * icon tells that the view itself is renamed.
 */
export function WidgetViewNameField({ value, placeholder, onCommit, disabled }: WidgetViewNameFieldProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);
  const skipBlurRef = useRef(false);
  // The name to show when a rename settles late: the current one, not the one at the commit.
  const valueRef = useRef(value);

  valueRef.current = value;

  // A rename from elsewhere (the tab bar, a collaborator) shows unless the field is being edited.
  useEffect(() => {
    if (document.activeElement !== inputRef.current) setDraft(value);
  }, [value]);

  const commit = () => {
    const name = draft.trim();

    if (!name || name === value.trim()) {
      setDraft(value);
      return;
    }

    // A rename that was refused or failed is not kept in the field: it would
    // show a name the view never got, with nothing telling so.
    new Promise<unknown>((resolve) => resolve(onCommit(name))).then(
      (written) => {
        if (written === false) setDraft(valueRef.current);
      },
      (error) => {
        Log.warn('[Dashboard] could not rename the widget view', error);
        setDraft(valueRef.current);
        toast.error(t('dashboard.widget.renameFailed', { defaultValue: 'Could not rename the view' }));
      }
    );
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // The host is a menu: its type-ahead must not take the keys typed here.
    event.stopPropagation();
    if (event.key === 'Enter') {
      event.preventDefault();
      commit();
      skipBlurRef.current = true;
      inputRef.current?.blur();
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      setDraft(value);
      skipBlurRef.current = true;
      inputRef.current?.blur();
    }
  };

  return (
    <div
      className='flex h-7 items-center gap-1 rounded-[6px] bg-fill-content-hover pl-2 pr-1.5'
      data-testid='dashboard-widget-view-name'
    >
      <input
        aria-label={t('dashboard.picker.viewName', { defaultValue: 'View name' })}
        className='min-w-0 flex-1 bg-transparent text-sm leading-5 text-text-primary outline-none placeholder:text-text-tertiary'
        data-testid='dashboard-widget-view-name-input'
        disabled={disabled}
        onBlur={() => {
          if (skipBlurRef.current) {
            skipBlurRef.current = false;
            return;
          }

          commit();
        }}
        onChange={(event) => setDraft(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        ref={inputRef}
        value={draft}
        {...{ [WIDGET_VIEW_NAME_FIELD_ATTR]: 'true' }}
      />
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className='flex h-4 w-4 shrink-0 items-center justify-center text-icon-tertiary'
            data-testid='dashboard-widget-view-name-hint'
          >
            <InfoIcon aria-hidden='true' className='h-4 w-4' />
          </span>
        </TooltipTrigger>
        <TooltipContent side='top'>
          {t('dashboard.widget.viewNameHint', { defaultValue: 'Renames this view' })}
        </TooltipContent>
      </Tooltip>
    </div>
  );
}

export default WidgetViewNameField;

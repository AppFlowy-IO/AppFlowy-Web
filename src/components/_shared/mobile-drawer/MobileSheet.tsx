import * as DialogPrimitive from '@radix-ui/react-dialog';
import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as BackIcon } from '@/assets/icons/alt_arrow_left.svg';
import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { Dialog, DialogOverlay, DialogPortal } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export type MobileSheetSize = 'auto' | 'full';

export interface MobileSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Centred in the header and truncated. */
  title: ReactNode;
  /** Which surface the sheet hosts (`widget-filter`, `drilldown`, ...), exposed as `data-sheet`. */
  sheet: string;
  /** `auto`: the content's height, at most 85% of the viewport. `full`: the viewport minus 24px. */
  size?: MobileSheetSize;
  /** A pushed screen: shows a back chevron on the left of the header. */
  onBack?: () => void;
  /** Accessible name when the title alone does not describe the sheet. */
  ariaLabel?: string;
  children: ReactNode;
}

const headerButtonClassName = cn(
  'absolute top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full text-icon-primary',
  'hover:bg-fill-content-hover focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-border-theme-thick',
  "before:absolute before:-inset-2 before:content-['']",
  '[&_svg]:h-4 [&_svg]:w-4'
);

/**
 * The phone bottom sheet: a drag handle, a 44px header (title, close and an
 * optional back chevron), and a scrolling body above the safe area. The
 * desktop app's `showDashboardSheet` has the same anatomy.
 *
 * Built on Radix Dialog rather than the MUI `MobileDrawer`: sheets host Radix
 * popovers (filter value editors, date pickers, option lists), and Radix
 * layers nest their focus scopes, while MUI's focus trap would steal focus
 * from the portaled popover inputs.
 */
export function MobileSheet({
  open,
  onOpenChange,
  title,
  sheet,
  size = 'auto',
  onBack,
  ariaLabel,
  children,
}: MobileSheetProps) {
  const { t } = useTranslation();
  const closeLabel = t('button.close', { defaultValue: 'Close' });
  const backLabel = t('button.back', { defaultValue: 'Back' });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogPortal>
        <DialogOverlay />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          // An explicit label replaces the title as the accessible name.
          {...(ariaLabel ? { 'aria-label': ariaLabel, 'aria-labelledby': undefined } : {})}
          className={cn(
            'fixed inset-x-0 bottom-0 z-50 flex w-full flex-col rounded-t-500 bg-surface-layer-01 shadow-dialog',
            'focus:outline-none focus-visible:outline-none',
            'duration-200 data-[state=open]:animate-in data-[state=open]:slide-in-from-bottom',
            size === 'full' ? 'h-[calc(100dvh-24px)]' : 'max-h-[85dvh]'
          )}
          data-sheet={sheet}
          data-size={size}
          data-testid='mobile-sheet'
        >
          <div
            aria-hidden='true'
            className='mx-auto my-2 h-1 w-9 shrink-0 rounded-[2px] bg-icon-quaternary'
            data-testid='mobile-sheet-handle'
          />
          <div className='relative flex h-11 shrink-0 items-center justify-center px-12'>
            {onBack ? (
              <button
                aria-label={backLabel}
                className={cn(headerButtonClassName, 'left-4')}
                data-testid='mobile-sheet-back'
                onClick={onBack}
                title={backLabel}
                type='button'
              >
                <BackIcon aria-hidden='true' />
              </button>
            ) : null}
            <DialogPrimitive.Title
              className='truncate text-base font-semibold leading-6 text-text-primary'
              data-testid='mobile-sheet-title'
            >
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              aria-label={closeLabel}
              className={cn(headerButtonClassName, 'right-4')}
              data-testid='mobile-sheet-close'
              title={closeLabel}
            >
              <CloseIcon aria-hidden='true' />
            </DialogPrimitive.Close>
          </div>
          <div
            className='min-h-0 flex-1 overflow-y-auto px-4 pb-[max(16px,env(safe-area-inset-bottom))]'
            data-testid='mobile-sheet-body'
          >
            {children}
          </div>
        </DialogPrimitive.Content>
      </DialogPortal>
    </Dialog>
  );
}

export interface MobileSheetItemProps {
  /** Stable id of the row (`view-data-source`, a view id, ...), exposed as `data-item-id`. */
  id: string;
  /** 20px leading icon. */
  icon?: ReactNode;
  label: ReactNode;
  onSelect: () => void;
  /** Trailing content, such as the check of the selected row. */
  trailing?: ReactNode;
  disabled?: boolean;
}

/** A 52px sheet row spanning the sheet's full width, its text 16px from the edges. */
export function MobileSheetItem({ id, icon, label, onSelect, trailing, disabled }: MobileSheetItemProps) {
  return (
    <button
      className={cn(
        '-mx-4 flex min-h-[52px] w-[calc(100%+2rem)] items-center gap-3 px-4 text-left text-base leading-6 text-text-primary',
        'hover:bg-fill-content-hover focus-visible:bg-fill-content-hover focus-visible:outline-none active:bg-fill-content-hover',
        'disabled:pointer-events-none disabled:text-text-tertiary'
      )}
      data-item-id={id}
      data-testid='mobile-sheet-item'
      disabled={disabled}
      onClick={onSelect}
      type='button'
    >
      {icon ? (
        <span className='flex h-5 w-5 shrink-0 items-center justify-center text-icon-primary [&_svg]:h-5 [&_svg]:w-5'>
          {icon}
        </span>
      ) : null}
      <span className='min-w-0 flex-1 truncate'>{label}</span>
      {trailing}
    </button>
  );
}

export default MobileSheet;

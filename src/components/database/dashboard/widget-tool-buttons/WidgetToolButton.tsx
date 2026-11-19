import { ComponentProps, forwardRef, FunctionComponent, ReactNode, SVGProps } from 'react';

import { Button } from '@/components/ui/button';
import { preventTooltipOnFocus, Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { DASHBOARD_ICON_BUTTON_CLASS } from '../dashboard-ui';

/** A 32px dashboard control with a 20px icon and an explicit keyboard focus ring. */
export const WIDGET_TOOL_BUTTON_CLASS = `${DASHBOARD_ICON_BUTTON_CLASS} data-[active=true]:bg-fill-theme-select data-[active=true]:text-icon-info-thick`;

type ButtonProps = ComponentProps<typeof Button>;

export interface WidgetToolButtonProps
  extends Omit<ButtonProps, 'aria-label' | 'asChild' | 'children' | 'size' | 'type' | 'variant'> {
  /** The accessible name, also shown in the hover-only tooltip. */
  label: string;
  /** The visual-parity id of the button; its glyph carries `<parityId>__icon`. */
  parityId: string;
  icon: FunctionComponent<SVGProps<SVGSVGElement>>;
  iconClassName?: string;
  /** Draw the glyph in the accent (Edit mode). */
  accent?: boolean;
  /** Drawn over the glyph (the unsaved dot); the button is `relative`. */
  badge?: ReactNode;
}

/**
 * The trigger every widget tool shares (Filter, Sort, Settings): a quiet
 * 32px ghost button with a 20px icon and a hover-only tooltip, like the
 * title's breadcrumb and the desktop tooltips: the focus a closing popover
 * hands back must not open it over the global filter bar just above the
 * header, where it would sit on the Save button. Extra props (`data-*`,
 * `onClick`, `data-state`) go to the button, so it can sit inside a Radix
 * trigger or anchor.
 */
export const WidgetToolButton = forwardRef<HTMLButtonElement, WidgetToolButtonProps>(function WidgetToolButton(
  { label, parityId, icon: Icon, iconClassName, accent = false, badge, className, ...buttonProps },
  ref
) {
  return (
    <Tooltip disableHoverableContent>
      <TooltipTrigger asChild onFocus={preventTooltipOnFocus}>
        <Button
          {...buttonProps}
          aria-label={label}
          className={cn(WIDGET_TOOL_BUTTON_CLASS, 'relative', accent && 'text-icon-info-thick', className)}
          data-parity-id={parityId}
          ref={ref}
          size='icon-sm'
          type='button'
          variant='ghost'
        >
          <Icon aria-hidden='true' className={iconClassName} data-parity-id={`${parityId}__icon`} />
          {badge}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
});

export default WidgetToolButton;

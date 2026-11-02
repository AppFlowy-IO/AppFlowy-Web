import { ComponentProps, forwardRef, FunctionComponent, ReactNode, SVGProps } from 'react';

import { Button } from '@/components/ui/button';
import { preventTooltipOnFocus, Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

/** A dashboard widget's tool: 24×24, radius 6, a 16px glyph; accent when active or in Edit mode. */
export const WIDGET_TOOL_BUTTON_CLASS =
  '!rounded-200 text-dash-tool-icon data-[active=true]:text-dash-edit-icon [&_svg]:h-4 [&_svg]:w-4';

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
 * 24px ghost button with a 16px glyph and a hover-only tooltip, like the
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
          className={cn(WIDGET_TOOL_BUTTON_CLASS, 'relative', accent && 'text-dash-edit-icon', className)}
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

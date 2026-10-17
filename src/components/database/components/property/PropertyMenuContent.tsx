import React from 'react';

import {
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export interface PropertyMenuOperation {
  testId: string;
  label: string;
  icon: React.ReactNode;
  onSelect?: React.ComponentProps<typeof DropdownMenuItem>['onSelect'];
  disabled?: boolean;
  disabledTooltip?: string;
  variant?: 'destructive';
}

/** Shared by row-property and column menus, including server-backed properties. */
export function PropertyMenuActions({
  operations,
  testIdPrefix = 'property-menu',
  preservePointerFocus = false,
  firstItemRef,
}: {
  operations: PropertyMenuOperation[];
  testIdPrefix?: string;
  preservePointerFocus?: boolean;
  firstItemRef?: React.Ref<HTMLDivElement>;
}) {
  return (
    <DropdownMenuGroup>
      {operations.map((operation, index) => {
        const item = (
          <DropdownMenuItem
            key={operation.testId}
            ref={index === 0 ? firstItemRef : undefined}
            data-testid={`${testIdPrefix}-${operation.testId}`}
            disabled={operation.disabled}
            onSelect={operation.onSelect}
            variant={operation.variant}
            {...(preservePointerFocus
              ? {
                  onPointerMove: (event) => event.preventDefault(),
                  onPointerEnter: (event) => event.preventDefault(),
                  onPointerLeave: (event) => event.preventDefault(),
                }
              : undefined)}
          >
            {operation.icon}
            {operation.label}
          </DropdownMenuItem>
        );

        return operation.disabled && operation.disabledTooltip ? (
          <Tooltip key={operation.testId} disableHoverableContent>
            <TooltipTrigger asChild>
              <div tabIndex={0}>{item}</div>
            </TooltipTrigger>
            <TooltipContent side='bottom'>{operation.disabledTooltip}</TooltipContent>
          </Tooltip>
        ) : (
          item
        );
      })}
    </DropdownMenuGroup>
  );
}

/** Property details use the same popover, spacing and action list for every storage backend. */
export function PropertyMenuContent({
  profile,
  typeSelector,
  operations,
  preservePointerFocus,
  children,
}: {
  profile: React.ReactNode;
  typeSelector: React.ReactNode;
  operations: PropertyMenuOperation[];
  preservePointerFocus?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <DropdownMenuContent side='bottom' align='start' onCloseAutoFocus={(event) => event.preventDefault()}>
      {profile}
      {typeSelector}
      {children}
      <DropdownMenuSeparator />
      <PropertyMenuActions operations={operations} preservePointerFocus={preservePointerFocus} />
    </DropdownMenuContent>
  );
}

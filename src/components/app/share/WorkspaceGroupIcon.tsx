import { ReactComponent as UsersIcon } from '@/assets/icons/users.svg';
import { cn } from '@/lib/utils';

export type WorkspaceGroupIconVariant = 'chip' | 'row' | 'settings-row' | 'hero' | 'name' | 'detail';

interface WorkspaceGroupIconProps {
  variant: WorkspaceGroupIconVariant;
  className?: string;
}

export function WorkspaceGroupIcon({ variant, className }: WorkspaceGroupIconProps) {
  const isBare = variant === 'chip' || variant === 'hero';
  const iconClassName: Record<WorkspaceGroupIconVariant, string> = {
    chip: 'h-4 w-4',
    row: 'h-5 w-5',
    'settings-row': 'h-5 w-5',
    hero: 'h-12 w-12',
    name: 'h-7 w-7',
    detail: 'h-9 w-9',
  };
  const icon = (
    <UsersIcon
      aria-hidden='true'
      data-slot='workspace-group-icon'
      data-testid={isBare ? `workspace-group-icon-${variant}` : undefined}
      className={cn('shrink-0 text-icon-secondary', iconClassName[variant], className)}
    />
  );

  if (isBare) return icon;

  const containerClassName: Record<Exclude<WorkspaceGroupIconVariant, 'chip' | 'hero'>, string> = {
    row: 'h-8 w-8 rounded-300',
    'settings-row': 'h-9 w-9 rounded-full',
    name: 'h-12 w-12 rounded-400 border border-border-primary',
    detail: 'h-16 w-16 rounded-full',
  };

  return (
    <div
      aria-hidden='true'
      data-slot='workspace-group-icon-container'
      data-testid={`workspace-group-icon-${variant}`}
      className={cn('flex shrink-0 items-center justify-center bg-fill-content-hover', containerClassName[variant])}
    >
      {icon}
    </div>
  );
}

import { ReactNode } from 'react';
import { Button, buttonVariants } from '@/components/ui/button';
import { ReactComponent as TickIcon } from '@/assets/icons/tick.svg';
import { VariantProps } from 'class-variance-authority';

interface MenuButtonProps {
    icon: ReactNode;
    label: ReactNode;
    isActive?: boolean;
    onClick: () => void;
    selected?: boolean;
    buttonProps?: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean };
}

export function MenuButton({ icon, label, isActive, onClick, selected, buttonProps }: MenuButtonProps) {
    return (
        <Button
            {...buttonProps}
            variant="ghost"
            className={`
                h-8 min-h-8 px-m
                flex items-center justify-start
                text-sm font-normal leading-5
                hover:bg-fill-list-hover
                focus-visible:outline-none focus-visible:ring-0
                focus:outline-none focus:border-0
                ${selected ? 'bg-fill-list-hover' : ''}
            `}
            onClick={onClick}
        >
            <span className="mr-1">{icon}</span>
            {label}
            {isActive && (
                <span className="ml-auto flex items-center">
                    <TickIcon className="h-5 w-5 text-icon-secondary" />
                </span>
            )}
        </Button>
    );
} 
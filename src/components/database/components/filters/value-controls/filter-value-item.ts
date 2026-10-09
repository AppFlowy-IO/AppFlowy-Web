import { dropdownMenuItemVariants } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

/** A row of a filter value list: an option, a person, "Clear selection". */
export const filterValueItemClassName = cn(dropdownMenuItemVariants({ variant: 'default' }), 'w-full text-left');

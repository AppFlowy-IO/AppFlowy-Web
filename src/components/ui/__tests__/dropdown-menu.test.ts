import { dropdownMenuItemVariants } from '@/components/ui/dropdown-menu';

describe('dropdownMenuItemVariants', () => {
  it('renders destructive actions in the error color before hover', () => {
    const className = dropdownMenuItemVariants({ variant: 'destructive' });

    expect(className.split(' ')).toEqual(expect.arrayContaining(['text-text-error', '[&_svg]:text-text-error']));
  });
});

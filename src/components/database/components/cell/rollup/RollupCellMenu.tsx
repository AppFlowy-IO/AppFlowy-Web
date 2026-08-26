import RollupPropertyMenuContent from '@/components/database/components/property/rollup/RollupPropertyMenuContent';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

export function RollupCellMenu({
  fieldId,
  open,
  onOpenChange,
}: {
  fieldId: string;
  open: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger className={'absolute left-0 top-0 z-[-1] h-full w-full'} />
      <DropdownMenuContent
        side={'bottom'}
        align={'start'}
        className={'w-[280px]'}
        onClick={(event) => event.stopPropagation()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <RollupPropertyMenuContent fieldId={fieldId} variant={'cell'} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

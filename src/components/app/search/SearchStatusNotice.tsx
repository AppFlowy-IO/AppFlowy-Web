import { Button } from '@/components/ui/button';

/**
 * Replaces a search list when there is nothing to list: no results yet because the browser is
 * offline, a read failed, or a list is genuinely empty. Keeps the list's title row and height so
 * the dialog does not jump, and announces the message to assistive technology.
 */
function SearchStatusNotice({
  title,
  message,
  actionLabel,
  onAction,
}: {
  title: string;
  message: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className={'flex flex-col'}>
      <div className={'flex items-center gap-4 px-4 pb-2 pt-5'}>{title}</div>
      <div
        role={'status'}
        className={'flex min-h-[280px] flex-col items-center justify-center gap-3 px-6 pb-6 text-center'}
      >
        <span className={'text-sm text-text-secondary'}>{message}</span>
        {actionLabel && onAction && (
          <Button variant={'outline'} size={'sm'} onClick={onAction}>
            {actionLabel}
          </Button>
        )}
      </div>
    </div>
  );
}

export default SearchStatusNotice;

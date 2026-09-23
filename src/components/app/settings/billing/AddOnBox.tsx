import { ReactComponent as CheckCircleIcon } from '@/assets/icons/check_circle.svg';
import { Button } from '@/components/ui/button';

interface AddOnBoxProps {
  title: string;
  description: string;
  price: string | null;
  priceInfo: string;
  active: boolean;
  addLabel: string;
  activeLabel: string;
  onAdd: () => void;
  testId?: string;
}

/** The plan page's purchasable add-on card: title, description, catalog price and an Add / Added button. */
export function AddOnBox({ title, description, price, priceInfo, active, addLabel, activeLabel, onAdd, testId }: AddOnBoxProps) {
  return (
    <div
      className='flex flex-col gap-3 rounded-[16px] border border-border-primary p-4'
      data-testid={testId}
      data-active={active ? 'true' : 'false'}
    >
      <div className='text-sm font-semibold text-text-primary'>{title}</div>
      <div className='text-xs text-text-secondary'>{description}</div>
      <div className='flex flex-col'>
        <div className='text-2xl font-medium text-text-primary'>{price ?? '—'}</div>
        <div className='text-xs text-text-secondary'>{priceInfo}</div>
      </div>
      {active ? (
        <Button variant='outline' size='default' disabled className='self-start'>
          <CheckCircleIcon className='h-4 w-4' />
          {activeLabel}
        </Button>
      ) : (
        <Button variant='default' size='default' className='self-start' onClick={onAdd}>
          {addLabel}
        </Button>
      )}
    </div>
  );
}

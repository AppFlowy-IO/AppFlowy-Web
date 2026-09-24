import { forwardRef, HTMLAttributes } from 'react';

import { FormulaFieldSchema } from '@/application/database-yjs/fields/formula';
import { FieldTypeIcon } from '@/components/database/components/field/FieldTypeIcon';
import { cn } from '@/lib/utils';

interface FormulaPropChipProps extends HTMLAttributes<HTMLSpanElement> {
  /** The referenced property; missing when the reference no longer resolves. */
  entry: FormulaFieldSchema | undefined;
  /** The reference as written, shown when the property is missing. */
  reference: string;
}

/** A property reference drawn like a select option tag: type icon and name. */
export const FormulaPropChip = forwardRef<HTMLSpanElement, FormulaPropChipProps>(function FormulaPropChip(
  { entry, reference, className, children, ...rest },
  ref
) {
  return (
    <span
      ref={ref}
      {...rest}
      data-highlight={'prop'}
      data-missing={entry ? undefined : 'true'}
      className={cn(
        'mx-0.5 inline-flex max-w-full select-none items-center gap-1 rounded-[6px] px-2 py-px align-middle font-sans text-xs leading-[1.5]',
        entry ? 'bg-[var(--tag-fill-10-light)] text-[var(--tag-text-10-light)]' : 'bg-fill-error-light text-text-error',
        className
      )}
    >
      {entry ? <FieldTypeIcon type={entry.type} className={'h-3.5 w-3.5 shrink-0 opacity-70'} /> : null}
      <span className={'truncate'}>{entry?.name ?? reference}</span>
      {children}
    </span>
  );
});

import { useFieldSelector } from '@/application/database-yjs';
import { useUpdatePropertyIconDispatch, useUpdatePropertyNameDispatch } from '@/application/database-yjs/dispatch';
import { YjsDatabaseKey } from '@/application/types';
import FieldCustomIcon from '@/components/database/components/field/FieldCustomIcon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';
import React, { useRef } from 'react';
import CustomIconPopover from 'src/components/_shared/cutsom-icon/CustomIconPopover';

function PropertyProfile ({ fieldId, onNext, onEnter, ...props }: {
  fieldId: string;
  onNext?: () => void;
  onEnter?: () => void;
} & React.HTMLAttributes<HTMLDivElement>) {
  const { field } = useFieldSelector(fieldId);
  const name = field?.get(YjsDatabaseKey.name);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const updateDispatch = useUpdatePropertyNameDispatch(fieldId);
  const updateIcon = useUpdatePropertyIconDispatch(fieldId);

  if (!field) {
    return null;
  }

  return (
    <div
      ref={ref}
      {...props}
      className={cn('flex focus:!bg-transparent hover:!bg-transparent !p-0 w-full justify-center items-center gap-[10px]', props.className)}
    >
      <CustomIconPopover
        tabs={['icon']}
        defaultActiveTab={'icon'}
        enableColor={false}
        removeIcon={() => {
          updateIcon('');
        }}
        onSelectIcon={(icon) => {
          console.log(icon);
          updateIcon(icon.value);
        }}
      >
        <Button
          variant={'outline'}
          className={'w-8 h-8 p-0'}
        >
          <FieldCustomIcon
            fieldId={fieldId}
            className={'text-text-secondary h-5 w-5'}
          />
        </Button>
      </CustomIconPopover>
      <Input
        ref={(input: HTMLInputElement) => {
          if (!input) return;
          if (!inputRef.current) {
            setTimeout(() => {
              input.setSelectionRange(0, input.value.length);
            }, 100);
            inputRef.current = input;
          }
        }}
        autoFocus={true}
        value={name}
        className={'flex-1'}
        onInput={e => {
          const target = e.target as HTMLInputElement;

          updateDispatch(target.value);
          // setName(target.value);
        }}
        onKeyDown={e => {
          e.stopPropagation();
          if (createHotkey(HOT_KEY_NAME.DOWN)(e.nativeEvent)) {
            e.preventDefault();
            inputRef.current?.blur();
            onNext?.();
            return;
          }

          if (createHotkey(HOT_KEY_NAME.ENTER)(e.nativeEvent)) {
            e.preventDefault();
            e.stopPropagation();
            onEnter?.();
            return;
          }
        }}
      />
    </div>
  );
}

export default PropertyProfile;
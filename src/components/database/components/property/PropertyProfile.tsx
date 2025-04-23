import { FieldType, useFieldSelector } from '@/application/database-yjs';
import { useUpdatePropertyNameDispatch } from '@/application/database-yjs/dispatch';
import { YjsDatabaseKey } from '@/application/types';
import { FieldTypeIcon } from '@/components/database/components/field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';
import React, { useRef } from 'react';

function PropertyProfile ({ fieldId, onNext, onEnter, ...props }: {
  fieldId: string;
  onNext?: () => void;
  onEnter?: () => void;
} & React.HTMLAttributes<HTMLDivElement>) {
  const { field } = useFieldSelector(fieldId);
  const type = field?.get(YjsDatabaseKey.type) as unknown as FieldType;
  const name = field?.get(YjsDatabaseKey.name);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const updateDispatch = useUpdatePropertyNameDispatch(fieldId);

  if (!field) {
    return null;
  }

  return (
    <div
      ref={ref}
      {...props}
      className={cn('flex focus:!bg-transparent hover:!bg-transparent !p-0 w-full justify-center items-center gap-[10px]', props.className)}
    >
      <Button
        variant={'outline'}
        className={'w-8 h-8'}
      >
        <FieldTypeIcon
          className={'h-5 w-5 text-icon-secondary'}
          type={type}
        />
      </Button>
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
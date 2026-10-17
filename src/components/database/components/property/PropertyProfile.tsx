import React, { useRef } from 'react';

import { useFieldSelector } from '@/application/database-yjs';
import { useUpdatePropertyIconDispatch, useUpdatePropertyNameDispatch } from '@/application/database-yjs/dispatch';
import { YjsDatabaseKey } from '@/application/types';
import FieldCustomIcon from '@/components/database/components/field/FieldCustomIcon';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { createHotkey, HOT_KEY_NAME } from '@/utils/hotkeys';
import { Log } from '@/utils/log';

import CustomIconPopover from 'src/components/_shared/cutsom-icon/CustomIconPopover';

function PropertyProfile({
  fieldId,
  onNext,
  onEnter,
  ...props
}: {
  fieldId: string;
  onNext?: () => void;
  onEnter?: () => void;
} & React.HTMLAttributes<HTMLDivElement>) {
  const { field } = useFieldSelector(fieldId);
  const name = field?.get(YjsDatabaseKey.name);
  const updateDispatch = useUpdatePropertyNameDispatch(fieldId);
  const updateIcon = useUpdatePropertyIconDispatch(fieldId);

  if (!field) {
    return null;
  }

  return (
    <PropertyProfileContent
      {...props}
      name={name ?? ''}
      onNameChange={updateDispatch}
      onNext={onNext}
      onEnter={onEnter}
      icon={
        <CustomIconPopover
          tabs={['icon']}
          defaultActiveTab={'icon'}
          enableColor={false}
          removeIcon={() => {
            updateIcon('');
          }}
          onSelectIcon={(icon) => {
            Log.debug(icon);
            updateIcon(icon.value);
          }}
        >
          <Button variant={'outline'} className={'h-8 w-8 p-0'}>
            <FieldCustomIcon fieldId={fieldId} className={'h-5 w-5 text-text-secondary'} />
          </Button>
        </CustomIconPopover>
      }
    />
  );
}

/** Shared name/icon header; immutable system properties omit the mutation callbacks. */
export function PropertyProfileContent({
  name,
  icon,
  onNameChange,
  onNext,
  onEnter,
  ...props
}: {
  name: string;
  icon: React.ReactNode;
  onNameChange?: (name: string) => void;
  onNext?: () => void;
  onEnter?: () => void;
} & React.HTMLAttributes<HTMLDivElement>) {
  const inputRef = useRef<HTMLInputElement | null>(null);

  return (
    <div
      {...props}
      className={cn(
        'flex w-full items-center justify-center gap-[10px] !p-0 hover:!bg-transparent focus:!bg-transparent',
        props.className
      )}
    >
      {icon}
      <Input
        data-testid={'property-name-input'}
        aria-label='Property name'
        readOnly={!onNameChange}
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
        onInput={(e) => {
          const target = e.target as HTMLInputElement;

          onNameChange?.(target.value);
        }}
        onKeyDown={(e) => {
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
            const target = e.target as HTMLInputElement;

            onNameChange?.(target.value);
            onEnter?.();
            return;
          }
        }}
      />
    </div>
  );
}

export default PropertyProfile;

import { SearchIcon } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';


interface SearchInputProps {
  value: string;
  className?: string;
  onChange: (value: string) => void;
  children?: React.ReactNode;
}

export function SearchInput({
  value,
  className,
  onChange,
  children,
}: SearchInputProps) {
  const [focused, setFocused] = useState(false);
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        'flex gap-2 items-center',
        'h-8 py-1.5 px-2 rounded-[8px] border-[1.5px]',
        focused ? 'border-border-theme-thick' : 'border-border-primary',
        className,
      )}
    >
      <SearchIcon size={20} className={'shrink-0 text-icon-secondary'} />

      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        autoFocus
        type='text'
        placeholder={t('chat.search.label')}
        className={
          '!p-0 !h-fit !ring-0 !border-none !shadow-none rounded-none text-sm text-text-primary caret-fill-theme-thick flex-1'
        }
      />
      {children}
    </div>
  );
}

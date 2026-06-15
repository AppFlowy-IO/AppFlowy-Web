import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { processUrl } from '@/utils/url';

export function EmbedLink({
  onDone,
  onEscape,
  defaultLink,
  placeholder,
  validator,
  focused,
  onFocus,
  onBlur,
}: {
  defaultLink?: string;
  onDone?: (value: string) => void;
  onEscape?: () => void;
  placeholder?: string;
  validator?: (url: string) => boolean;
  focused?: boolean;
  onFocus?: () => void;
  onBlur?: () => void;
}) {
  const { t } = useTranslation();

  const [value, setValue] = useState(defaultLink ?? '');
  const [error, setError] = useState(false);

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const value = e.target.value;

      setValue(value);
      const urlValid = !!processUrl(value);
      const customValid = validator ? validator(value) : true;

      setError(!urlValid || !customValid);
    },
    [setValue, setError, validator]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !error && value) {
        e.preventDefault();
        e.stopPropagation();
        onDone?.(value);
      }

      if (e.key === 'Escape') {
        onEscape?.();
      }
    },
    [error, onDone, onEscape, value]
  );

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (focused) {
      inputRef.current?.focus();
    }
  }, [focused]);

  return (
    <div tabIndex={0} onKeyDown={handleKeyDown} className={'flex flex-col items-center gap-2'}>
      <Input
        variant={error ? 'destructive' : 'default'}
        autoFocus
        ref={inputRef}
        onKeyDown={handleKeyDown}
        spellCheck={false}
        onChange={handleChange}
        value={value}
        className={'w-full'}
        placeholder={placeholder || t('document.imageBlock.embedLink.placeholder')}
        onFocus={onFocus}
        onBlur={onBlur}
      />
      {error && <div className={'text-text-error'}>{t('editor.incorrectLink')}</div>}
      <Button className={'w-full'} onClick={() => onDone?.(value)} disabled={error || !value}>
        {t('document.imageBlock.embedLink.label')}
      </Button>
    </div>
  );
}

export default EmbedLink;

import { processUrl } from '@/utils/url';
import React, { useCallback, useState } from 'react';
import TextField from '@mui/material/TextField';
import { useTranslation } from 'react-i18next';
import Button from '@mui/material/Button';

export function EmbedLink({
  onDone,
  onEscape,
  defaultLink,
  placeholder,
  validator,
}: {
  defaultLink?: string;
  onDone?: (value: string) => void;
  onEscape?: () => void;
  placeholder?: string;
  validator?: (url: string) => boolean;
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
    [setValue, setError, validator],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if(e.key === 'Enter' && !error && value) {
        e.preventDefault();
        e.stopPropagation();
        onDone?.(value);
      }

      if(e.key === 'Escape') {
        onEscape?.();
      }
    },
    [error, onDone, onEscape, value],
  );

  return (
    <div
      tabIndex={0}
      onKeyDown={handleKeyDown}
      className={'flex flex-col items-center gap-4 px-4 pb-4'}
    >
      <TextField
        error={error}
        autoFocus
        onKeyDown={handleKeyDown}
        size={'small'}
        spellCheck={false}
        onChange={handleChange}
        helperText={error ? t('editor.incorrectLink') : ''}
        value={value}
        placeholder={placeholder || t('document.imageBlock.embedLink.placeholder')}
        fullWidth
      />
      <Button
        variant={'contained'}
        className={'w-full'}
        onClick={() => onDone?.(value)}
        disabled={error || !value}
      >
        {t('document.imageBlock.embedLink.label')}
      </Button>
    </div>
  );
}

export default EmbedLink;

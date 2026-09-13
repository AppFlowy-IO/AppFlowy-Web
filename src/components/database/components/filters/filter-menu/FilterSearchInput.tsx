import { useTranslation } from 'react-i18next';

export function FilterSearchInput({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useTranslation();

  return (
    <div className='flex items-center gap-1 p-1'>
      <input
        aria-label={t('search.label', { defaultValue: 'Search' })}
        placeholder={t('search.label', { defaultValue: 'Search' })}
        className='h-8 min-w-0 flex-1 rounded-md border border-border-primary bg-transparent px-2 text-sm'
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {value && (
        <button
          type='button'
          aria-label={t('search.clear', { defaultValue: 'Clear search' })}
          onClick={() => onChange('')}
          className='h-8 px-2'
        >
          ×
        </button>
      )}
    </div>
  );
}

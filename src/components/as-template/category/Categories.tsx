import {
  Chip,
  CircularProgress,
  FormControl,
  FormHelperText,
  InputLabel,
  MenuItem,
  OutlinedInput,
  Select,
  Typography,
} from '@mui/material';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as ArrowRight } from '@/assets/icons/alt_arrow_right.svg';
import { Popover } from '@/components/_shared/popover';
import AddCategory from '@/components/as-template/category/AddCategory';
import CategoryItem from '@/components/as-template/category/CategoryItem';
import { useLoadCategories } from '@/components/as-template/hooks';
import { CategoryIcon } from '@/components/as-template/icons';

import type { Dispatch, SetStateAction } from 'react';

const ITEM_HEIGHT = 48;
const ITEM_PADDING_TOP = 8;
const MenuProps = {
  disableAutoFocus: true,
  disableRestoreFocus: true,
  disableEnforceFocus: true,
  PaperProps: {
    className: 'p-2 appflowy-scroller',
  },
};

function Categories({
  value,
  onChange,
  primaryCategoryId,
  onPrimaryCategoryChange,
  disabled = false,
}: {
  value: string[];
  onChange: Dispatch<SetStateAction<string[]>>;
  primaryCategoryId?: string;
  onPrimaryCategoryChange: (id: string) => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const primaryLabelId = useId();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [searchText, setSearchText] = useState('');

  const { categories, allCategories, loading, loadCategories } = useLoadCategories({
    searchText,
  });

  const selectedCategories = useMemo(() => {
    return allCategories.filter((category) => value.includes(category.id));
  }, [allCategories, value]);

  const reloadCategories = useCallback(async () => {
    const updated = await loadCategories();

    if (!updated) return;
    const available = new Set(updated.map((category) => category.id));

    onChange((previous) => {
      const selected = previous.filter((id) => available.has(id));

      return selected.length === previous.length ? previous : selected;
    });
  }, [loadCategories, onChange]);

  const handleSelect = useCallback(
    (id: string) => {
      onChange((prev) => {
        if (prev.includes(id)) {
          return prev.filter((categoryId) => categoryId !== id);
        }

        return [...prev, id];
      });
    },
    [onChange]
  );

  useEffect(() => {
    void reloadCategories();
  }, [reloadCategories]);

  return (
    <div className={'flex flex-col gap-4'}>
      <Typography variant={'h6'} className={'text-text-secondary'}>
        {t('template.categories')}
      </Typography>
      <div className={'flex items-center gap-2'}>
        <OutlinedInput
          disabled={disabled}
          value={searchText}
          placeholder={t('template.category.typeToSearch')}
          onChange={(e) => setSearchText(e.target.value)}
          endAdornment={
            loading ? (
              <CircularProgress size={'small'} />
            ) : (
              <ArrowRight className={`h-5 w-5 ${open ? '-rotate-90' : 'rotate-90'} text-text-secondary`} />
            )
          }
          size={'small'}
          onClick={async () => {
            setOpen(true);
          }}
          className={'flex-1 bg-background-primary'}
          ref={ref}
        />
        <Popover {...MenuProps} open={open && !disabled} anchorEl={ref.current} onClose={() => setOpen(false)}>
          <div
            className={'flex w-full flex-col gap-1'}
            style={{
              minWidth: ref.current?.clientWidth,
              maxHeight: ITEM_HEIGHT * 10 + ITEM_PADDING_TOP,
            }}
          >
            <AddCategory searchText={searchText} onCreated={reloadCategories} />

            {categories.map((category) => (
              <CategoryItem
                key={category.id}
                category={category}
                selected={value.includes(category.id)}
                onClick={() => handleSelect(category.id)}
                reloadCategories={reloadCategories}
              />
            ))}
          </div>
        </Popover>
      </div>
      <div className={'flex flex-wrap gap-2'}>
        {selectedCategories.map((category) => {
          const isPrimary = category.id === primaryCategoryId;
          const primaryActionLabel = t('template.markPrimaryCategory', {
            defaultValue: 'Use {{category}} as primary category',
            category: category.name,
          });

          return (
            <Chip
              disabled={disabled}
              key={category.id}
              icon={<CategoryIcon icon={category.icon} />}
              label={
                isPrimary
                  ? `${category.name} (${t('template.primaryCategoryShort', { defaultValue: 'Primary' })})`
                  : category.name
              }
              aria-label={primaryActionLabel}
              aria-pressed={isPrimary}
              title={primaryActionLabel}
              onClick={() => onPrimaryCategoryChange(category.id)}
              style={{
                backgroundColor: category.bg_color,
              }}
              className={'template-category border-transparent px-3 text-black'}
              variant='outlined'
            />
          );
        })}
      </div>
      <FormControl size='small' disabled={disabled || selectedCategories.length === 0}>
        <InputLabel id={primaryLabelId}>
          {t('template.primaryCategory', { defaultValue: 'Primary category' })}
        </InputLabel>
        <Select
          labelId={primaryLabelId}
          label={t('template.primaryCategory', { defaultValue: 'Primary category' })}
          value={selectedCategories.some((category) => category.id === primaryCategoryId) ? primaryCategoryId : ''}
          onChange={(event) => onPrimaryCategoryChange(event.target.value)}
        >
          {selectedCategories.map((category) => (
            <MenuItem key={category.id} value={category.id}>
              {category.name}
            </MenuItem>
          ))}
        </Select>
        <FormHelperText>
          {t('template.primaryCategoryHelp', {
            defaultValue: 'Click a category above or choose here. Used in the template page URL.',
          })}
        </FormHelperText>
      </FormControl>
    </div>
  );
}

export default Categories;

import { Chip, CircularProgress, OutlinedInput, Typography } from '@mui/material';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as ArrowRight } from '@/assets/icons/alt_arrow_right.svg';
import { Popover } from '@/components/_shared/popover';
import AddCategory from '@/components/as-template/category/AddCategory';
import CategoryItem from '@/components/as-template/category/CategoryItem';
import { useLoadCategories } from '@/components/as-template/hooks';
import { CategoryIcon } from '@/components/as-template/icons';

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

function Categories({ value, onChange }: { value: string[]; onChange: React.Dispatch<React.SetStateAction<string[]>> }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const [searchText, setSearchText] = useState('');

  const { categories, loading, loadCategories } = useLoadCategories({
    searchText,
  });

  const selectedCategories = useMemo(() => {
    return categories.filter((category) => value.includes(category.id));
  }, [categories, value]);

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
    void loadCategories();
  }, [loadCategories]);

  return (
    <div className={'flex flex-col gap-4'}>
      <Typography variant={'h6'} className={'text-text-secondary'}>
        {t('template.categories')}
      </Typography>
      <div className={'flex items-center gap-2'}>
        <OutlinedInput
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
        <Popover {...MenuProps} open={open} anchorEl={ref.current} onClose={() => setOpen(false)}>
          <div
            className={'flex w-full flex-col gap-1'}
            style={{
              minWidth: ref.current?.clientWidth,
              maxHeight: ITEM_HEIGHT * 10 + ITEM_PADDING_TOP,
            }}
          >
            <AddCategory searchText={searchText} onCreated={loadCategories} />

            {categories.map((category) => (
              <CategoryItem
                key={category.id}
                category={category}
                selected={value.includes(category.id)}
                onClick={() => handleSelect(category.id)}
                reloadCategories={loadCategories}
              />
            ))}
          </div>
        </Popover>
      </div>
      <div className={'flex flex-wrap gap-2'}>
        {selectedCategories.map((category) => (
          <Chip
            key={category.id}
            icon={<CategoryIcon icon={category.icon} />}
            label={category.name}
            style={{
              backgroundColor: category.bg_color,
            }}
            className={'template-category border-transparent px-3 text-black'}
            variant='outlined'
          />
        ))}
      </div>
    </div>
  );
}

export default Categories;

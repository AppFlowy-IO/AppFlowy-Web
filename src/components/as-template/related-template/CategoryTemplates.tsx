import { Button, Collapse, OutlinedInput, Skeleton } from '@mui/material';
import { debounce } from 'lodash-es';
import React, { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import { TemplateCategory, TemplateSummary } from '@/application/template.type';
import { ReactComponent as RightIcon } from '@/assets/icons/alt_arrow_right.svg';
import { ReactComponent as SearchIcon } from '@/assets/icons/search.svg';
import { useLoadCategoryTemplates } from '@/components/as-template/hooks';
import { CategoryIcon } from '@/components/as-template/icons';
import CategoryTemplateItem from '@/components/as-template/related-template/CategoryTemplateItem';

function CategoryTemplates({
  category,
  selectedTemplateIds,
  onChange,
  updateTemplate,
}: {
  category: TemplateCategory;
  selectedTemplateIds: string[];
  onChange: (value: string[]) => void;
  updateTemplate: (template: TemplateSummary) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const [searchText, setSearchText] = React.useState('');
  const { templates, loading, loadCategoryTemplates } = useLoadCategoryTemplates();
  const [searchParams] = useSearchParams();

  const filteredTemplates = useMemo(() => {
    const currentTemplateViewId = searchParams.get('viewId');

    return templates.filter((template) => template.view_id !== currentTemplateViewId);
  }, [templates, searchParams]);

  const handleClick = () => {
    setOpen((prev) => {
      if (!prev) {
        void loadCategoryTemplates(category.id);
      }

      return !prev;
    });
  };

  const debounceSearch = useMemo(() => {
    return debounce((id: string, searchText: string) => {
      void loadCategoryTemplates(id, searchText);
    }, 300);
  }, [loadCategoryTemplates]);

  useEffect(() => {
    filteredTemplates.forEach((template) => {
      updateTemplate(template);
    });
  }, [filteredTemplates, updateTemplate]);

  useEffect(() => {
    return () => {
      debounceSearch.cancel();
    };
  }, [debounceSearch]);

  return (
    <div className={'flex flex-col gap-2'}>
      <Button
        onClick={handleClick}
        className={'flex items-center justify-between gap-2 font-medium text-text-secondary'}
      >
        <CategoryIcon icon={category.icon} />
        <div className={'flex-1 text-left'}>{category.name}</div>
        <RightIcon className={`h-5 w-5 ${open ? 'rotate-90 transform' : ''}`} />
      </Button>
      <Collapse in={open} timeout='auto' unmountOnExit>
        <OutlinedInput
          size={'small'}
          fullWidth
          value={searchText}
          className={'mb-2 gap-2'}
          startAdornment={<SearchIcon className={'h-5 w-5'} />}
          placeholder={t('template.searchInCategory', {
            category: category.name,
          })}
          onChange={(e) => {
            setSearchText(e.target.value);
            debounceSearch(category.id, e.target.value);
          }}
        />
        {loading ? (
          <div className={'flex w-full flex-col gap-2'}>
            <Skeleton variant={'rectangular'} height={40} />
            <Skeleton variant={'rectangular'} height={40} />
            <Skeleton variant={'rectangular'} height={40} />
          </div>
        ) : (
          <div className={'flex flex-col'}>
            {filteredTemplates.map((template) => {
              const isSelected = selectedTemplateIds.includes(template.view_id);

              return (
                <CategoryTemplateItem
                  key={template.view_id}
                  template={template}
                  isSelected={isSelected}
                  onChange={(checked) => {
                    if (checked) {
                      onChange([...selectedTemplateIds, template.view_id]);
                    } else {
                      onChange(selectedTemplateIds.filter((id) => id !== template.view_id));
                    }
                  }}
                />
              );
            })}
          </div>
        )}
      </Collapse>
    </div>
  );
}

export default React.memo(CategoryTemplates);

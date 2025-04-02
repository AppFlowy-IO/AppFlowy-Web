import { TemplateCategory } from '@/application/template.type';
import DeleteCategory from '@/components/as-template/category/DeleteCategory';
import EditCategory from '@/components/as-template/category/EditCategory';
import { CategoryIcon } from '@/components/as-template/icons';
import { Chip, IconButton, Tooltip } from '@mui/material';
import MenuItem from '@mui/material/MenuItem';
import React, { useState } from 'react';
import { ReactComponent as CheckIcon } from '@/assets/icons/tick.svg';
import { ReactComponent as EditIcon } from '@/assets/icons/edit.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { useTranslation } from 'react-i18next';

function CategoryItem ({
  onClick,
  category,
  selected,
  reloadCategories,
}: {
  onClick: () => void;
  category: TemplateCategory;
  selected: boolean;
  reloadCategories: () => void;
}) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  return (
    <MenuItem
      className={'flex items-center gap-2 w-full justify-between'} onClick={onClick}
      onMouseLeave={() => setHovered(false)} onMouseEnter={() => setHovered(true)}
    >
      <Chip
        icon={<CategoryIcon icon={category.icon} />}
        label={category.name}
        variant="outlined"
        className={'border-transparent template-category px-4'}
        style={{
          backgroundColor: category.bg_color,
          color: 'black',
        }}
      />
      <div style={{
        display: hovered ? 'flex' : 'none',
      }} className={'flex gap-1 items-center'}
      >
        <Tooltip title={t('button.edit')}>
          <IconButton size={'small'} onClick={(e) => {
            e.stopPropagation();
            setEditModalOpen(true);
          }}
          >
            <EditIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title={t('button.delete')}>
          <IconButton size={'small'} onClick={(e) => {
            e.stopPropagation();
            setDeleteModalOpen(true);
          }}
          >
            <DeleteIcon className={'text-function-error'} />
          </IconButton>
        </Tooltip>
      </div>
      {selected && !hovered && <CheckIcon className={'w-5 h-5 text-fill-default'} />}
      {
        editModalOpen &&
        <EditCategory
          category={category}
          onClose={() => setEditModalOpen(false)}
          openModal={editModalOpen}
          onUpdated={reloadCategories}
        />
      }
      {
        deleteModalOpen &&
        <DeleteCategory
          id={category.id}
          onClose={() => setDeleteModalOpen(false)}
          open={deleteModalOpen}
          onDeleted={reloadCategories}
        />
      }
    </MenuItem>
  );
}

export default CategoryItem;
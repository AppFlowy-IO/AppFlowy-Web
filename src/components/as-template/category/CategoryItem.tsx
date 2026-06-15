import { Chip, IconButton, Tooltip } from '@mui/material';
import MenuItem from '@mui/material/MenuItem';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { TemplateCategory } from '@/application/template.type';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as EditIcon } from '@/assets/icons/edit.svg';
import { ReactComponent as CheckIcon } from '@/assets/icons/tick.svg';
import DeleteCategory from '@/components/as-template/category/DeleteCategory';
import EditCategory from '@/components/as-template/category/EditCategory';
import { CategoryIcon } from '@/components/as-template/icons';

function CategoryItem({
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
      className={'flex w-full items-center justify-between gap-2'}
      onClick={onClick}
      onMouseLeave={() => setHovered(false)}
      onMouseEnter={() => setHovered(true)}
    >
      <Chip
        icon={<CategoryIcon icon={category.icon} />}
        label={category.name}
        variant='outlined'
        className={'template-category border-transparent px-4'}
        style={{
          backgroundColor: category.bg_color,
          color: 'black',
        }}
      />
      <div
        style={{
          display: hovered ? 'flex' : 'none',
        }}
        className={'flex items-center gap-1'}
      >
        <Tooltip title={t('button.edit')}>
          <IconButton
            size={'small'}
            onClick={(e) => {
              e.stopPropagation();
              setEditModalOpen(true);
            }}
          >
            <EditIcon />
          </IconButton>
        </Tooltip>
        <Tooltip title={t('button.delete')}>
          <IconButton
            size={'small'}
            onClick={(e) => {
              e.stopPropagation();
              setDeleteModalOpen(true);
            }}
          >
            <DeleteIcon className={'text-function-error'} />
          </IconButton>
        </Tooltip>
      </div>
      {selected && !hovered && <CheckIcon className={'h-5 w-5 text-text-action'} />}
      {editModalOpen && (
        <EditCategory
          category={category}
          onClose={() => setEditModalOpen(false)}
          openModal={editModalOpen}
          onUpdated={reloadCategories}
        />
      )}
      {deleteModalOpen && (
        <DeleteCategory
          id={category.id}
          onClose={() => setDeleteModalOpen(false)}
          open={deleteModalOpen}
          onDeleted={reloadCategories}
        />
      )}
    </MenuItem>
  );
}

export default CategoryItem;

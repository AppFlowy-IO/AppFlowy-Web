import { IconButton, Tooltip } from '@mui/material';
import MenuItem from '@mui/material/MenuItem';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { TemplateCreator } from '@/application/template.type';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as EditIcon } from '@/assets/icons/edit.svg';
import { ReactComponent as CheckIcon } from '@/assets/icons/tick.svg';
import CreatorAvatar from '@/components/as-template/creator/CreatorAvatar';
import DeleteCreator from '@/components/as-template/creator/DeleteCreator';
import EditCreator from '@/components/as-template/creator/EditCreator';

function CreatorItem({
  onClick,
  creator,
  selected,
  reloadCreators,
}: {
  onClick: () => void;
  creator: TemplateCreator;
  selected: boolean;
  reloadCreators: () => void;
}) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);

  return (
    <MenuItem
      className={'flex items-center justify-between gap-2'}
      onClick={onClick}
      onMouseLeave={() => setHovered(false)}
      onMouseEnter={() => setHovered(true)}
    >
      <div className={'flex items-center gap-2 border-transparent'}>
        <CreatorAvatar size={40} src={creator.avatar_url} name={creator.name} />
        <span className={'text-text-secondary'}>{creator.name}</span>
      </div>
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
        <EditCreator
          creator={creator}
          onClose={() => setEditModalOpen(false)}
          openModal={editModalOpen}
          onUpdated={reloadCreators}
        />
      )}
      {deleteModalOpen && (
        <DeleteCreator
          id={creator.id}
          onClose={() => setDeleteModalOpen(false)}
          open={deleteModalOpen}
          onDeleted={reloadCreators}
        />
      )}
    </MenuItem>
  );
}

export default CreatorItem;

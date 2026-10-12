import { Button, Skeleton } from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { TemplateService } from '@/application/services/domains';
import { Template } from '@/application/template.type';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as EditIcon } from '@/assets/icons/edit.svg';
import { useAppView } from '@/components/app/app.hooks';
import LinkPreview from '@/components/app/share/LinkPreview';
import { useLoadPublishInfo } from '@/components/app/share/publish.hooks';
import AsTemplateButton from '@/components/as-template/AsTemplateButton';
import DeleteTemplate from '@/components/as-template/DeleteTemplate';
import { getTemplatePath } from '@/components/as-template/utils';

function TemplatePanel({ viewId }: { viewId: string }) {
  const view = useAppView(viewId);
  const [loading, setLoading] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [template, setTemplateInfo] = useState<Template>();
  const loadTemplateInfo = useCallback(async() => {
    if(!view?.view_id) return;
    setLoading(true);
    try {
      const res = await TemplateService.getById(view?.view_id);

      setTemplateInfo(res);
      // eslint-disable-next-line
    } catch(e: any) {
      // do nothing
    } finally {
      setLoading(false);
    }
  }, [view?.view_id]);
  const { t } = useTranslation();
  const {
    url: publishUrl,
  } = useLoadPublishInfo(viewId);

  const path = template ? getTemplatePath(template) : '';
  const url = path ? `${window.location.origin}${path}` : '';

  useEffect(() => {
    void loadTemplateInfo();
  }, [loadTemplateInfo]);

  const renderLoading = useCallback(() => {
    return <>
      <Skeleton
        variant={'rectangular'}
        height={40}
      />
      <div className={'flex items-center gap-1.5 justify-end w-full'}>
        <Skeleton
          variant={'rectangular'}
          height={32}
          className={'flex-1 max-w-[50%]'}
        />

        <Skeleton
          variant={'rectangular'}
          height={32}
          className={'flex-1 max-w-[50%]'}
        />
      </div>
    </>;
  }, []);
  const handleEditClick = useCallback(() => {

    window.open(`${window.origin}/as-template?viewUrl=${encodeURIComponent(publishUrl)}&viewName=${view?.name || ''}&viewId=${view?.view_id || ''}`, '_blank');
  }, [view, publishUrl]);

  const renderTemplateButtons = useCallback(() => {
    return <>
      <LinkPreview url={url} />
      <div className={'flex items-center gap-1.5 justify-end w-full'}>
        <Button
          color={'error'}
          variant={'contained'}
          startIcon={<DeleteIcon />}
          className={'flex-1'}
          onClick={() => {
            setDeleteModalOpen(true);
          }}
        >
          {t('button.delete')}
        </Button>
        <Button
          startIcon={<EditIcon />}
          className={'flex-1'}
          onClick={handleEditClick}
          variant={'outlined'}
          color={'inherit'}
        >{t('button.edit')}</Button>
      </div>
    </>;
  }, [handleEditClick, t, url]);

  return (
    <div className={'flex flex-col gap-2'}>
      {loading ? renderLoading() : template ? renderTemplateButtons() : <AsTemplateButton viewId={viewId} />}
      {deleteModalOpen && view &&
        <DeleteTemplate
          id={view.view_id}
          open={deleteModalOpen}
          onDeleted={() => {
            void loadTemplateInfo();
          }}
          onClose={() => setDeleteModalOpen(false)}
        />}
    </div>
  );
}

export default TemplatePanel;

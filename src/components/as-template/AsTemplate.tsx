import { Button, CircularProgress, InputLabel, Paper, Switch } from '@mui/material';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { TemplateService } from '@/application/services/domains';
import { UploadTemplatePayload } from '@/application/template.type';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as WebsiteIcon } from '@/assets/icons/earth.svg';
import { notify } from '@/components/_shared/notify';
import { AFScroller } from '@/components/_shared/scroller';
import AsTemplateForm, { AsTemplateFormValue } from '@/components/as-template/AsTemplateForm';
import Categories from '@/components/as-template/category/Categories';
import Creator from '@/components/as-template/creator/Creator';
import DeleteTemplate from '@/components/as-template/DeleteTemplate';
import { useLoadTemplate } from '@/components/as-template/hooks';
import { getTemplatePath } from '@/components/as-template/utils';

import './template.scss';

function AsTemplate({ viewName, viewUrl, viewId }: { viewName: string; viewUrl: string; viewId: string }) {
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([]);
  const [primaryCategoryId, setPrimaryCategoryId] = useState<string | undefined>();
  const selectedPrimaryCategoryId = selectedCategoryIds.includes(primaryCategoryId ?? '')
    ? primaryCategoryId
    : undefined;
  const [selectedCreatorId, setSelectedCreatorId] = useState<string | undefined>(undefined);
  const { t } = useTranslation();
  const [isNewTemplate, setIsNewTemplate] = useState(false);
  const [isFeatured, setIsFeatured] = useState(false);
  const [deleteModalOpen, setDeleteModalOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const savingRef = useRef(false);
  const { template, loadTemplate, loading } = useLoadTemplate(viewId);

  const handleSubmit = useCallback(
    async (data: AsTemplateFormValue) => {
      if (!selectedCreatorId || !selectedPrimaryCategoryId || loading || savingRef.current) return;
      // Keep the write and reload together so a second full-payload save cannot race them.
      savingRef.current = true;
      setIsSaving(true);
      const formData: UploadTemplatePayload = {
        ...data,
        view_id: viewId,
        category_ids: selectedCategoryIds,
        primary_category_id: selectedPrimaryCategoryId,
        creator_id: selectedCreatorId,
        is_new_template: isNewTemplate,
        is_featured: isFeatured,
        view_url: viewUrl,
      };

      try {
        if (template) {
          await TemplateService.update(template.view_id, formData);
        } else {
          await TemplateService.create(formData);
        }

        await loadTemplate();

        notify.success('Template saved successfully');
      } catch (error) {
        // eslint-disable-next-line
        // @ts-ignore
        notify.error(error.toString());
      } finally {
        savingRef.current = false;
        setIsSaving(false);
      }
    },
    [
      selectedCreatorId,
      selectedCategoryIds,
      selectedPrimaryCategoryId,
      isNewTemplate,
      isFeatured,
      viewId,
      viewUrl,
      template,
      loadTemplate,
      loading,
    ]
  );
  const submitRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void loadTemplate();
  }, [loadTemplate]);

  useEffect(() => {
    if (!template) return;
    setSelectedCategoryIds(template.categories.map((category) => category.id));
    setPrimaryCategoryId(template.primary_category_id ?? undefined);
    setSelectedCreatorId(template.creator.id);
    setIsNewTemplate(template.is_new_template);
    setIsFeatured(template.is_featured);
  }, [template]);

  const defaultValue = useMemo(() => {
    if (!template)
      return {
        name: viewName,
        description: '',
        about: '',
        related_view_ids: [],
      };

    return {
      name: template.name,
      description: template.description,
      about: template.about,
      related_view_ids: template.related_templates?.map((related) => related.view_id) || [],
    };
  }, [template, viewName]);

  return (
    <div className={'flex h-full w-full flex-col gap-4 overflow-hidden'}>
      <div className={'flex items-center justify-end'}>
        {template && (
          <Button
            startIcon={<WebsiteIcon />}
            variant={'text'}
            onClick={() => {
              const path = getTemplatePath(template);

              if (path) window.open(`${window.location.origin}${path}`);
            }}
            color={'primary'}
          >
            {t('template.viewTemplate')}
          </Button>
        )}
        <div className={'flex items-center gap-2'}>
          {template && (
            <Button
              startIcon={<DeleteIcon />}
              color={'error'}
              disabled={isSaving}
              onClick={() => {
                setDeleteModalOpen(true);
              }}
              variant={'text'}
            >
              {t('template.deleteTemplate')}
            </Button>
          )}

          <Button
            onClick={() => {
              submitRef.current?.click();
            }}
            variant={'contained'}
            color={'primary'}
            disabled={!selectedCreatorId || !selectedPrimaryCategoryId || loading || isSaving}
          >
            {t('button.save')}
          </Button>
        </div>
      </div>
      <div
        {...(isSaving ? { inert: '' } : {})}
        aria-busy={isSaving}
        className={'flex flex-1 gap-20 overflow-hidden'}
      >
        <Paper className={'flex h-full w-full flex-1 justify-center overflow-hidden'}>
          <AFScroller className={'flex h-full w-full justify-center'} overflowXHidden>
            {loading ? (
              <CircularProgress />
            ) : (
              <AsTemplateForm
                defaultValues={defaultValue}
                viewUrl={viewUrl}
                onSubmit={handleSubmit}
                ref={submitRef}
                defaultRelatedTemplates={template?.related_templates}
              />
            )}
          </AFScroller>
        </Paper>
        <div className={'flex w-[25%] flex-col gap-4'}>
          <Categories
            value={selectedCategoryIds}
            onChange={setSelectedCategoryIds}
            primaryCategoryId={selectedPrimaryCategoryId}
            onPrimaryCategoryChange={setPrimaryCategoryId}
            disabled={isSaving}
          />
          <Creator value={selectedCreatorId} onChange={setSelectedCreatorId} disabled={isSaving} />
          <div className={'flex items-center gap-2'}>
            <InputLabel>{t('template.isNewTemplate')}</InputLabel>
            <Switch checked={isNewTemplate} onChange={() => setIsNewTemplate(!isNewTemplate)} />
          </div>
          <div className={'flex items-center gap-2'}>
            <InputLabel>{t('template.featured')}</InputLabel>
            <Switch checked={isFeatured} onChange={() => setIsFeatured(!isFeatured)} />
          </div>
        </div>
      </div>
      {deleteModalOpen && (
        <DeleteTemplate
          id={viewId}
          onDeleted={() => {
            void loadTemplate();
          }}
          open={deleteModalOpen}
          onClose={() => setDeleteModalOpen(false)}
        />
      )}
    </div>
  );
}

export default AsTemplate;

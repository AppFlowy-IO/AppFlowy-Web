import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { CoverType, ViewMetaCover } from '@/application/types';
import { EmbedLink, TAB_KEY, TabOption, Unsplash, UploadImage, UploadPopover } from '@/components/_shared/image-upload';
import { useAppHandlers, useAppViewId, useOpenModalViewId } from '@/components/app/app.hooks';
import { useSubscriptionPlan } from '@/components/app/hooks/useSubscriptionPlan';
import { GradientEnum } from '@/utils/color';

import Colors from './CoverColors';

function CoverPopover({
  coverValue,
  open,
  onOpenChange,
  onUpdateCover,
  children,
}: {
  coverValue?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUpdateCover?: (cover: ViewMetaCover) => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation();
  const { uploadFile, getSubscriptions } = useAppHandlers();
  const appViewId = useAppViewId();
  const modalViewId = useOpenModalViewId();
  const viewId = modalViewId || appViewId;

  const { isPro } = useSubscriptionPlan(getSubscriptions);

  const tabOptions: TabOption[] = useMemo(() => {
    return [
      {
        label: t('document.plugins.cover.colors'),
        key: TAB_KEY.Colors,
        Component: (props) => <Colors {...props} isPro={isPro} selectedColor={coverValue} />,
        onDone: (value: string) => {
          const isGradient = Object.values(GradientEnum).includes(value as GradientEnum);

          onUpdateCover?.({
            type: isGradient ? CoverType.GradientColor : CoverType.NormalColor,
            value,
            offset: 0,
          });
        },
      },
      {
        label: t('button.upload'),
        key: TAB_KEY.UPLOAD,
        Component: UploadImage,
        uploadAction: (file: File) => {
          if (!viewId || !uploadFile) return Promise.reject();
          return uploadFile(viewId, file);
        },
        onDone: (value: string) => {
          onUpdateCover?.({
            type: CoverType.CustomImage,
            value,
            offset: 0,
          });
          onOpenChange(false);
        },
      },
      {
        label: t('document.imageBlock.embedLink.label'),
        key: TAB_KEY.EMBED_LINK,
        Component: EmbedLink,
        onDone: (value: string) => {
          onUpdateCover?.({
            type: CoverType.CustomImage,
            value,
            offset: 0,
          });
          onOpenChange(false);
        },
      },
      {
        key: TAB_KEY.UNSPLASH,
        label: t('document.imageBlock.unsplash.label'),
        Component: Unsplash,
        onDone: (value: string) => {
          onUpdateCover?.({
            type: CoverType.UpsplashImage,
            value,
            offset: 0,
          });
        },
      },
    ];
  }, [coverValue, isPro, onOpenChange, onUpdateCover, t, uploadFile, viewId]);

  return (
    <UploadPopover open={open} onOpenChange={onOpenChange} tabOptions={tabOptions}>
      {children}
    </UploadPopover>
  );
}

export default CoverPopover;

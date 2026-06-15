import React, { lazy, Suspense, useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { CoverType, ViewIconType, ViewLayout, ViewMetaCover, ViewMetaIcon, ViewMetaProps } from '@/application/types';
import { CustomIconPopover } from '@/components/_shared/cutsom-icon';
import { notify } from '@/components/_shared/notify';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import TitleEditable from '@/components/view-meta/TitleEditable';
import ViewCover from '@/components/view-meta/ViewCover';
import { ColorEnum } from '@/utils/color';
import { clampCoverOffset } from '@/utils/cover';

const AddIconCover = lazy(() => import('@/components/view-meta/AddIconCover'));

const normalizeCover = (cover?: ViewMetaCover | null): ViewMetaCover | null => {
  if (!cover) return null;

  return {
    ...cover,
    offset: clampCoverOffset(cover.offset),
  };
};

export function ViewMetaPreview({
  icon: iconProp,
  cover: coverProp,
  name,
  extra,
  readOnly = true,
  viewId,
  updatePage,
  onEnter,
  maxWidth,
  uploadFile,
  layout,
  onFocus,
  updatePageIcon,
  updatePageName,
}: ViewMetaProps) {
  const [cover, setCover] = React.useState<ViewMetaCover | null>(normalizeCover(coverProp));
  const [icon, setIcon] = React.useState<ViewMetaIcon | null>(iconProp || null);

  useEffect(() => {
    setCover(normalizeCover(coverProp));
  }, [coverProp]);

  useEffect(() => {
    setIcon(iconProp || null);
  }, [iconProp]);

  const coverType = useMemo(() => {
    if (cover && [CoverType.NormalColor, CoverType.GradientColor].includes(cover.type)) {
      return 'color';
    }

    if (CoverType.BuildInImage === cover?.type) {
      return 'built_in';
    }

    if (cover && [CoverType.CustomImage, CoverType.UpsplashImage].includes(cover.type)) {
      return 'custom';
    }
  }, [cover]);

  const coverValue = useMemo(() => {
    if (coverType === CoverType.BuildInImage) {
      return {
        1: '/covers/m_cover_image_1.png',
        2: '/covers/m_cover_image_2.png',
        3: '/covers/m_cover_image_3.png',
        4: '/covers/m_cover_image_4.png',
        5: '/covers/m_cover_image_5.png',
        6: '/covers/m_cover_image_6.png',
      }[cover?.value as string];
    }

    return cover?.value;
  }, [coverType, cover?.value]);
  const { t } = useTranslation();

  const [isHover, setIsHover] = React.useState(false);

  const handleUpdateIcon = React.useCallback(
    async (icon: { ty: ViewIconType; value: string }) => {
      if (!updatePageIcon || !viewId) return;
      setIcon(icon);
      try {
        await updatePageIcon(viewId, icon);
        // eslint-disable-next-line
      } catch (e: any) {
        notify.error(e.message);
      }
    },
    [updatePageIcon, viewId]
  );

  const handleUpdateName = React.useCallback(
    async (newName: string) => {
      if (!updatePageName || !viewId) return;
      try {
        if (name === newName) return;
        await updatePageName(viewId, newName);
        // eslint-disable-next-line
      } catch (e: any) {
        notify.error(e.message);
      }
    },
    [name, updatePageName, viewId]
  );

  const handleUpdateCover = React.useCallback(
    async (newCover?: ViewMetaCover) => {
      if (!updatePage || !viewId) return;
      const normalizedCover = normalizeCover(newCover);

      setCover(normalizedCover);

      try {
        await updatePage(viewId, {
          icon: icon || {
            ty: ViewIconType.Emoji,
            value: '',
          },
          name: name || '',
          extra: {
            ...(extra || {}),
            cover: normalizedCover || undefined,
          },
        });
        // eslint-disable-next-line
      } catch (e: any) {
        notify.error(e.message);
      }
    },
    [extra, icon, name, updatePage, viewId]
  );

  const onUploadFile = useCallback(
    async (file: File) => {
      if (!uploadFile) return Promise.reject();
      return uploadFile(file);
    },
    [uploadFile]
  );

  const ref = React.useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    const handleMouseEnter = () => {
      setIsHover(true);
    };

    const handleMouseLeave = () => {
      setIsHover(false);
    };

    if (el) {
      el.addEventListener('mouseenter', handleMouseEnter);
      el.addEventListener('mouseleave', handleMouseLeave);
    }

    return () => {
      if (el) {
        el.removeEventListener('mouseenter', handleMouseEnter);
        el.removeEventListener('mouseleave', handleMouseLeave);
      }
    };
  }, []);

  return (
    <div className={'flex w-full flex-col items-center'}>
      {cover && (
        <ViewCover
          onUpdateCover={handleUpdateCover}
          coverType={coverType}
          coverValue={coverValue}
          onRemoveCover={handleUpdateCover}
          readOnly={readOnly}
          layout={layout}
          coverOffset={cover?.offset}
        />
      )}
      <div ref={ref} data-testid='view-meta-hover-area' className={'relative flex w-full flex-col overflow-hidden'}>
        <div
          style={{
            height: layout === ViewLayout.Document ? '40px' : '32px',
          }}
          className={'relative flex w-full justify-center max-sm:h-[32px]'}
        >
          {!readOnly && (
            <Suspense>
              <AddIconCover
                visible={isHover}
                hasIcon={!!icon?.value}
                hasCover={!!cover?.value}
                onUpdateIcon={handleUpdateIcon}
                onAddCover={() => {
                  void handleUpdateCover({
                    type: CoverType.NormalColor,
                    value: ColorEnum.Tint1,
                    offset: 0,
                  });
                }}
                maxWidth={maxWidth}
                onUploadFile={onUploadFile}
              />
            </Suspense>
          )}
        </div>
        <div
          style={{
            marginBottom: layout === ViewLayout.Document ? '24px' : '16px',
          }}
          className={`relative flex w-full items-center justify-center overflow-visible`}
        >
          <h1
            style={{
              width: maxWidth || '100%',
              fontSize: layout === ViewLayout.Document ? '2.5rem' : '26px',
            }}
            className={
              'flex min-w-0 max-w-full gap-4 overflow-hidden whitespace-pre-wrap break-words break-all px-24 font-bold max-md:text-[26px] max-sm:px-6'
            }
          >
            {icon?.value ? (
              <CustomIconPopover
                enable={!readOnly}
                removeIcon={() => {
                  void handleUpdateIcon({
                    ty: ViewIconType.Emoji,
                    value: '',
                  });
                }}
                onSelectIcon={(icon) => {
                  if (icon.ty === ViewIconType.Icon) {
                    void handleUpdateIcon({
                      ty: ViewIconType.Icon,
                      value: JSON.stringify({
                        color: icon.color,
                        groupName: icon.value.split('/')[0],
                        iconName: icon.value.split('/')[1],
                      }),
                    });
                    return;
                  }

                  void handleUpdateIcon(icon);
                }}
                onUploadFile={onUploadFile}
              >
                <div
                  className={`view-icon flex h-[1.25em] w-[1.25em] items-center justify-center px-1.5 ${readOnly ? 'cursor-default' : 'cursor-pointer hover:bg-fill-content-hover '
                    }`}
                >
                  <PageIcon
                    view={{
                      icon,
                      layout: ViewLayout.Document,
                    }}
                    className={'flex h-[90%] w-[90%] min-w-[36px] items-center justify-center'}
                  />
                </div>
              </CustomIconPopover>
            ) : null}
            {!readOnly && viewId ? (
              <>
                <TitleEditable
                  onFocus={onFocus}
                  viewId={viewId}
                  name={name || ''}
                  onUpdateName={handleUpdateName}
                  onEnter={onEnter}
                />
              </>
            ) : (
              <>
                <div
                  style={{
                    wordBreak: 'break-word',
                  }}
                  className={
                    'relative flex-1 cursor-text whitespace-pre-wrap break-words empty:before:text-text-tertiary empty:before:content-[attr(data-placeholder)] focus:outline-none'
                  }
                  data-placeholder={t('menuAppHeader.defaultNewPageName')}
                  contentEditable={false}
                >
                  {name}
                </div>
              </>
            )}
          </h1>
        </div>
      </div>
    </div>
  );
}

export default ViewMetaPreview;

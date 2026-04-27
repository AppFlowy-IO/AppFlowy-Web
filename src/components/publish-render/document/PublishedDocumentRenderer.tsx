import { useEffect, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import type { PublishedDocumentSnapshot } from '@/application/publish-snapshot/types';
import { FontLayout, LineHeightLayout, UIVariant } from '@/application/types';
import StaticEditor from '@/components/editor/StaticEditor';
import PublishedPageMeta from '@/components/publish-render/shared/PublishedPageMeta';
import { usePublishContext } from '@/application/publish';
import { getFontFamily } from '@/utils/font';

const FONT_SIZE_MAP: Record<FontLayout, string | undefined> = {
  [FontLayout.small]: '14px',
  [FontLayout.normal]: '16px',
  [FontLayout.large]: '20px',
};

const THUMBNAIL_BLOCK_LIMIT = 10;

interface PublishedViewExtra {
  font?: string;
  fontLayout?: FontLayout;
  lineHeightLayout?: LineHeightLayout;
}

function parseViewExtra(extra: string | null): PublishedViewExtra {
  if (!extra) return {};
  try {
    const parsed = JSON.parse(extra);

    return parsed && typeof parsed === 'object' ? parsed as PublishedViewExtra : {};
  } catch {
    return {};
  }
}

export function PublishedDocumentRenderer({ snapshot }: { snapshot: PublishedDocumentSnapshot }) {
  const publishContext = usePublishContext();
  const onRendered = publishContext?.onRendered;
  const isTemplateThumb = publishContext?.isTemplateThumb ?? false;
  const [search] = useSearchParams();
  const jumpBlockId = search.get('blockId') || undefined;

  const extra = useMemo(() => parseViewExtra(snapshot.view.extra), [snapshot.view.extra]);
  const font = extra.font || '';
  const fontLayout = extra.fontLayout;
  const lineHeightLayout = extra.lineHeightLayout;

  const editorValue = useMemo(() => {
    if (!isTemplateThumb) return snapshot.document.children;

    return snapshot.document.children.slice(0, THUMBNAIL_BLOCK_LIMIT);
  }, [isTemplateThumb, snapshot.document.children]);

  const wrapperStyle = useMemo(() => {
    const style: React.CSSProperties = {};

    if (font) style.fontFamily = font;
    if (fontLayout) {
      const fontSize = FONT_SIZE_MAP[fontLayout];

      if (fontSize) style.fontSize = fontSize;
    }

    return style;
  }, [font, fontLayout]);

  const wrapperClassName = useMemo(() => {
    const classes = ['flex min-h-[calc(100vh-48px)] w-full flex-col items-center'];

    if (fontLayout === FontLayout.large) classes.push('font-large');
    else if (fontLayout === FontLayout.small) classes.push('font-small');

    if (lineHeightLayout === LineHeightLayout.large) classes.push('line-height-large');
    else if (lineHeightLayout === LineHeightLayout.small) classes.push('line-height-small');

    return classes.join(' ');
  }, [fontLayout, lineHeightLayout]);

  useEffect(() => {
    onRendered?.();
  }, [onRendered]);

  useEffect(() => {
    if (!font) return;
    void getFontFamily(font);
  }, [font]);

  return (
    <div className={wrapperClassName} style={wrapperStyle}>
      <PublishedPageMeta view={snapshot.view} />
      <div className="relative flex w-full justify-center">
        <StaticEditor
          workspaceId="publish"
          viewId={snapshot.view.viewId}
          value={editorValue}
          navigateToView={publishContext?.toView}
          loadViewMeta={publishContext?.loadViewMeta}
          loadView={publishContext?.loadView}
          loadRowDocument={publishContext?.loadRowDocument}
          createRow={publishContext?.createRow}
          onRendered={onRendered}
          variant={UIVariant.Publish}
          databaseRelations={snapshot.view.databaseRelations}
          getViewIdFromDatabaseId={publishContext?.getViewIdFromDatabaseId}
          jumpBlockId={jumpBlockId}
          readSummary={isTemplateThumb}
        />
      </div>
    </div>
  );
}

export default PublishedDocumentRenderer;

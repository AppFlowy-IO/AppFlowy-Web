import { CoverType, RowCoverType, View, ViewCover, ViewIconType } from '@/application/types';
import { clampCoverOffset } from '@/utils/cover';

import { DatabaseRowTemplate } from './types';

type PersistedRowCover = {
  cover_type: RowCoverType;
  data: string;
  offset: number;
};

function viewCoverTypeToRowCoverType(type: CoverType): RowCoverType | undefined {
  switch (type) {
    case CoverType.GradientColor:
      return RowCoverType.GradientCover;
    case CoverType.NormalColor:
      return RowCoverType.ColorCover;
    case CoverType.BuildInImage:
      return RowCoverType.AssetCover;
    case CoverType.CustomImage:
    case CoverType.LocalImage:
    case CoverType.UpsplashImage:
      return RowCoverType.FileCover;
    case CoverType.None:
      return undefined;
  }
}

function rowCoverTypeToViewCoverType(type: unknown): CoverType | undefined {
  switch (type) {
    case RowCoverType.GradientCover:
      return CoverType.GradientColor;
    case RowCoverType.ColorCover:
      return CoverType.NormalColor;
    case RowCoverType.AssetCover:
      return CoverType.BuildInImage;
    case RowCoverType.FileCover:
      // Row metadata intentionally collapses custom, local, and Unsplash
      // images into one file-cover representation.
      return CoverType.CustomImage;
    default:
      return undefined;
  }
}

/** Convert Desktop/Web folder-view cover metadata into database-row metadata. */
export function viewCoverToTemplateCover(cover?: ViewCover | null): string | undefined {
  if (!cover || !cover.value) return undefined;
  const coverType = viewCoverTypeToRowCoverType(cover.type);

  if (coverType === undefined) return undefined;

  const rowCover: PersistedRowCover = {
    cover_type: coverType,
    data: cover.value,
    offset: clampCoverOffset(cover.offset),
  };

  return JSON.stringify(rowCover);
}

/** Convert database-row cover metadata back to the folder-view representation Desktop renders. */
export function templateCoverToViewCover(raw?: string): ViewCover | undefined {
  if (!raw?.trim()) return undefined;

  try {
    const parsed: unknown = JSON.parse(raw);

    if (typeof parsed !== 'object' || parsed === null) return undefined;
    const value = 'data' in parsed && typeof parsed.data === 'string' ? parsed.data : '';
    const type = 'cover_type' in parsed ? rowCoverTypeToViewCoverType(parsed.cover_type) : undefined;
    const offset = 'offset' in parsed && typeof parsed.offset === 'number' ? parsed.offset : undefined;

    if (!value || type === undefined) return undefined;

    return {
      type,
      value,
      offset: clampCoverOffset(offset),
    };
  } catch {
    return undefined;
  }
}

/**
 * Missing properties mean the template predates Web's decoration extensions
 * and still needs its Desktop orphan-view metadata resolved. Empty strings are
 * explicit, already-resolved "no decoration" values.
 */
export function templateDecorationsNeedResolution(template: DatabaseRowTemplate): boolean {
  return template.icon === undefined || template.cover === undefined;
}

/**
 * Desktop persists template decorations on the orphan document view. Merge
 * those values only when the shared template JSON does not already contain a
 * Web-authored value.
 */
export function mergeTemplateViewDecorations(
  template: DatabaseRowTemplate,
  view?: Pick<View, 'icon' | 'extra'> | null
): DatabaseRowTemplate {
  const icon =
    template.icon === undefined
      ? view?.icon?.ty === ViewIconType.Emoji
        ? view.icon.value.trim()
        : ''
      : template.icon.trim();
  const cover =
    template.cover === undefined ? viewCoverToTemplateCover(view?.extra?.cover) ?? '' : template.cover.trim();

  if (icon === template.icon && cover === template.cover) return template;

  return {
    ...template,
    icon,
    cover,
  };
}

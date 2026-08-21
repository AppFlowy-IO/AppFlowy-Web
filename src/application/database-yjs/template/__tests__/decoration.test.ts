import {
  mergeTemplateViewDecorations,
  templateDecorationsNeedResolution,
  templateCoverToViewCover,
  viewCoverToTemplateCover,
} from '@/application/database-yjs/template/decoration';
import { CoverType, RowCoverType, ViewIconType } from '@/application/types';

import { DatabaseRowTemplate } from '../types';

const template: DatabaseRowTemplate = {
  templateId: 'template-id',
  name: 'Template',
  docViewId: 'document-id',
  isDocumentEmpty: true,
  embeddedDatabases: [],
  defaultCells: {},
  createdAtMs: 1,
  updatedAtMs: 1,
};

describe('database template decorations', () => {
  it.each([
    [CoverType.NormalColor, RowCoverType.ColorCover],
    [CoverType.GradientColor, RowCoverType.GradientCover],
    [CoverType.BuildInImage, RowCoverType.AssetCover],
    [CoverType.CustomImage, RowCoverType.FileCover],
    [CoverType.LocalImage, RowCoverType.FileCover],
    [CoverType.UpsplashImage, RowCoverType.FileCover],
  ])('maps the %s view cover to Desktop row metadata', (type, expectedType) => {
    const raw = viewCoverToTemplateCover({ type, value: 'cover-value', offset: 2 });

    expect(JSON.parse(raw as string)).toEqual({
      cover_type: expectedType,
      data: 'cover-value',
      offset: 1,
    });
  });

  it.each([
    [RowCoverType.ColorCover, CoverType.NormalColor],
    [RowCoverType.GradientCover, CoverType.GradientColor],
    [RowCoverType.AssetCover, CoverType.BuildInImage],
    [RowCoverType.FileCover, CoverType.CustomImage],
  ])('maps the %s row cover back to folder-view metadata', (coverType, expectedType) => {
    expect(templateCoverToViewCover(JSON.stringify({ cover_type: coverType, data: 'cover-value', offset: -2 }))).toEqual(
      {
        type: expectedType,
        value: 'cover-value',
        offset: -1,
      }
    );
  });

  it('rejects missing, none, and malformed cover metadata', () => {
    expect(viewCoverToTemplateCover()).toBeUndefined();
    expect(viewCoverToTemplateCover({ type: CoverType.None, value: 'ignored' })).toBeUndefined();
    expect(templateCoverToViewCover('{bad json')).toBeUndefined();
    expect(templateCoverToViewCover(JSON.stringify({ cover_type: 99, data: 'ignored' }))).toBeUndefined();
  });

  it('merges Desktop orphan-view decorations without replacing explicit template values', () => {
    const view = {
      icon: { ty: ViewIconType.Emoji, value: ' 🧩 ' },
      extra: { cover: { type: CoverType.BuildInImage, value: '3', offset: 0.5 } },
    };
    const merged = mergeTemplateViewDecorations(template, view);

    expect(merged.icon).toBe('🧩');
    expect(templateCoverToViewCover(merged.cover)).toEqual(view.extra.cover);

    const explicit = mergeTemplateViewDecorations({ ...template, icon: '🐛', cover: 'saved-cover' }, view);

    expect(explicit.icon).toBe('🐛');
    expect(explicit.cover).toBe('saved-cover');
  });

  it('resolves missing decorations once and preserves explicit empty values', () => {
    expect(templateDecorationsNeedResolution(template)).toBe(true);

    const resolvedWithoutDecorations = mergeTemplateViewDecorations(template, null);

    expect(resolvedWithoutDecorations.icon).toBe('');
    expect(resolvedWithoutDecorations.cover).toBe('');
    expect(templateDecorationsNeedResolution(resolvedWithoutDecorations)).toBe(false);

    const explicitEmpty = mergeTemplateViewDecorations(
      { ...template, icon: '', cover: '' },
      {
        icon: { ty: ViewIconType.Emoji, value: '🐛' },
        extra: { cover: { type: CoverType.BuildInImage, value: '2', offset: 0 } },
      }
    );

    expect(explicitEmpty.icon).toBe('');
    expect(explicitEmpty.cover).toBe('');
  });
});

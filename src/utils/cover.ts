import { CoverType, type ViewCover } from '@/application/types';

/** Resolve the same cover types and built-in assets on page and presentation surfaces. */
export function resolveViewCover(cover?: ViewCover | null) {
  if (!cover?.value) return;
  if (cover.type === CoverType.NormalColor || cover.type === CoverType.GradientColor) {
    return { coverType: 'color', coverValue: cover.value };
  }

  if (cover.type === CoverType.BuildInImage) {
    const coverValue = {
      1: '/covers/m_cover_image_1.png',
      2: '/covers/m_cover_image_2.png',
      3: '/covers/m_cover_image_3.png',
      4: '/covers/m_cover_image_4.png',
      5: '/covers/m_cover_image_5.png',
      6: '/covers/m_cover_image_6.png',
    }[cover.value];

    return coverValue ? { coverType: 'built_in', coverValue } : undefined;
  }

  if (cover.type === CoverType.CustomImage || cover.type === CoverType.UpsplashImage) {
    return { coverType: 'custom', coverValue: cover.value };
  }
}

export function clampCoverOffset(offset?: number): number {
  if (typeof offset !== 'number' || Number.isNaN(offset)) {
    return 0;
  }

  if (offset > 1) {
    return 1;
  }

  if (offset < -1) {
    return -1;
  }

  return offset;
}

export function coverOffsetToObjectPosition(offset?: number): string {
  const clamped = clampCoverOffset(offset);
  const percent = ((clamped + 1) / 2) * 100;

  return `50% ${percent}%`;
}

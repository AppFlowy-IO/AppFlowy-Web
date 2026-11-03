import ImageRender from '@/components/_shared/image-render/ImageRender';
import { renderColor } from '@/utils/color';
import { coverOffsetToObjectPosition } from '@/utils/cover';

/** Shared cover artwork, without page editing controls or layout constraints. */
export default function ViewCoverContent({
  coverType,
  coverValue,
  coverOffset,
}: {
  coverType: string;
  coverValue: string;
  coverOffset?: number;
}) {
  if (coverType === 'color') {
    return <div style={{ background: renderColor(coverValue) }} className='h-full w-full' />;
  }

  if (coverType === 'custom' || coverType === 'built_in') {
    return (
      <ImageRender
        key={coverValue}
        draggable={false}
        src={coverValue}
        alt=''
        className='h-full w-full object-cover'
        style={{ objectPosition: coverOffsetToObjectPosition(coverOffset) }}
      />
    );
  }

  return null;
}

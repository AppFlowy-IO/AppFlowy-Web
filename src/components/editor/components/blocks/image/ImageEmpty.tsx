import React from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as ImageIcon } from '@/assets/icons/image.svg';
import { ImageBlockNode } from '@/components/editor/editor.type';

function ImageEmpty(_: { containerRef: React.RefObject<HTMLDivElement>; onEscape: () => void; node: ImageBlockNode }) {
  const { t } = useTranslation();

  return (
    <>
      <div className={'flex w-full select-none items-center gap-4 text-text-secondary'}>
        <ImageIcon className={'h-6 w-6'} />
        {t('document.plugins.image.addAnImageDesktop')}
      </div>
    </>
  );
}

export default ImageEmpty;

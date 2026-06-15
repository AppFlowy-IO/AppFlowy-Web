import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { filterViews } from '@/components/_shared/outline/utils';
import { useAppOutline } from '@/components/app/app.hooks';
import ViewList from '@/components/app/search/ViewList';

function TitleMatch ({
  onClose,
  searchValue,
}: {
  onClose: () => void;
  searchValue: string;
}) {
  const outline = useAppOutline();
  const { t } = useTranslation();

  const views = useMemo(() => {
    if (!outline) return [];
    return filterViews(outline, searchValue);
  }, [outline, searchValue]);

  return (
    <ViewList
      loading={false}
      views={views}
      title={t('commandPalette.bestMatches')}
      onClose={onClose}
    />
  );
}

export default TitleMatch;
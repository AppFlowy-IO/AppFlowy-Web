import { useTranslation } from 'react-i18next';

function UnsupportedView() {
  const { t } = useTranslation();

  return (
    <div className="flex h-full w-full items-center justify-center text-text-secondary">
      <span className="text-base">{t('common.comingSoonToWeb')}</span>
    </div>
  );
}

export default UnsupportedView;

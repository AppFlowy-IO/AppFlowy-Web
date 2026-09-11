import { useTranslation } from 'react-i18next';

/** Row-page Documents have their own history, separate from row properties. */
export function HistoricalRowDocumentNotice() {
  const { t } = useTranslation();

  return (
    <p className='px-3 py-2 text-xs text-text-tertiary' data-testid='database-history-document-unavailable'>
      {t('databaseHistory.rowDocumentUnavailable', 'Row-page content is not included in database history.')}
    </p>
  );
}

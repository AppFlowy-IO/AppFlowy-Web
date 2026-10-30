import { Alert } from '@mui/material';
import { FallbackProps } from 'react-error-boundary';
import i18n from 'i18next';

import { getErrorMessage } from '@/utils/errors';
import { useErrorCatalogRevision } from '@/components/main/hooks/useServerErrorCatalog';

/**
 * Pass to ErrorBoundary as `FallbackComponent`, not `fallbackRender`. react-error-boundary calls
 * `fallbackRender` as a plain function inside its class render, where the hook below throws
 * React error #321 and the page-level boundary replaces the page.
 */
export function ElementFallbackRender({
  error,
  description,
}: FallbackProps & {
  description?: string;
}) {
  useErrorCatalogRevision();
  // Use i18n.t directly instead of useTranslation hook to avoid context dependency
  // This prevents crashes when error boundary renders outside of I18nextProvider
  const errorLabel = i18n.isInitialized ? i18n.t('error.generalError') : 'Something went wrong';

  return (
    <Alert severity={'error'} variant={'standard'} contentEditable={false} className={'my-2 overflow-hidden'}>
      <p>{errorLabel}:</p>
      <pre className={'truncate'}>{getErrorMessage(error)}</pre>
      {description && <pre>{description}</pre>}
    </Alert>
  );
}

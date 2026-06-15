import { Alert } from '@mui/material';
import { FallbackProps } from 'react-error-boundary';
import i18n from 'i18next';

export function ElementFallbackRender({
  error,
  description,
}: FallbackProps & {
  description?: string;
}) {
  // Use i18n.t directly instead of useTranslation hook to avoid context dependency
  // This prevents crashes when error boundary renders outside of I18nextProvider
  const errorLabel = i18n.isInitialized ? i18n.t('error.generalError') : 'Something went wrong';

  return (
    <Alert severity={'error'} variant={'standard'} contentEditable={false} className={'my-2 overflow-hidden'}>
      <p>{errorLabel}:</p>
      <pre className={'truncate'}>{error.message}</pre>
      {description && <pre>{description}</pre>}
    </Alert>
  );
}

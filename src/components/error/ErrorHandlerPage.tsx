import { useState } from 'react';

import { useErrorCatalogRevision } from '@/components/main/hooks/useServerErrorCatalog';
import { getErrorMessage } from '@/utils/errors';

import { ErrorModal } from './ErrorModal';

export const ErrorHandlerPage = ({ error }: { error: Error }) => {
  const [dismissedError, setDismissedError] = useState<Error>();

  useErrorCatalogRevision();

  return error && error !== dismissedError
    ? <ErrorModal message={getErrorMessage(error)} onClose={() => setDismissedError(error)} />
    : null;
};

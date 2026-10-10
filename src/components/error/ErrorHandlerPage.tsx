import { useCallback, useEffect, useState } from 'react';

import { getErrorMessage } from '@/utils/errors';

import { ErrorModal } from './ErrorModal';

export const ErrorHandlerPage = ({ error }: { error: Error }) => {
  const [displayError, setDisplayError] = useState(true);
  const [errorMessage, setErrorMessage] = useState(() => getErrorMessage(error));

  const hideError = () => {
    setDisplayError(false);
  };

  const showError = useCallback((msg: string) => {
    setErrorMessage(msg);
    setDisplayError(true);
  }, []);

  useEffect(() => {
    if (error) {
      showError(getErrorMessage(error));
    } else {
      setDisplayError(false);
    }
  }, [error, showError]);

  return displayError ? <ErrorModal message={errorMessage} onClose={hideError}></ErrorModal> : <></>;
};

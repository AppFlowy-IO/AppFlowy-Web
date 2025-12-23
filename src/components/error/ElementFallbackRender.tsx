import { Alert } from '@mui/material';
import { FallbackProps } from 'react-error-boundary';

export function ElementFallbackRender({
  error,
  description,
}: FallbackProps & {
  description?: string;
}) {
  return (
    <Alert severity={'error'} variant={'standard'} contentEditable={false} className={'my-2 overflow-hidden'}>
      <p>An error occurred:</p>
      <pre className={'truncate'}>{error.message}</pre>
      {description && <pre>{description}</pre>}
    </Alert>
  );
}

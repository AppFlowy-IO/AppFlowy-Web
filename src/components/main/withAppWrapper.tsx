import { styled } from '@mui/material/styles';
import { SnackbarProvider } from 'notistack';
import { Suspense } from 'react';
import { ErrorBoundary } from 'react-error-boundary';

import CustomSnackbar from '@/components/_shared/notify/CustomSnackbar';
import AppConfig from '@/components/main/AppConfig';
import AppTheme from '@/components/main/AppTheme';

import { ErrorHandlerPage } from 'src/components/error/ErrorHandlerPage';



import { InfoSnackbar } from '../_shared/notify';

const StyledSnackbarProvider = styled(SnackbarProvider)`
    &.notistack-MuiContent-default {
        background-color: var(--fill-toolbar);
    }

    &.notistack-MuiContent-info {
        background-color: var(--function-info);
    }

`;

export default function withAppWrapper (Component: React.FC): React.FC {
  return function AppWrapper (): JSX.Element {
    return (
      <AppTheme>
        <ErrorBoundary FallbackComponent={ErrorHandlerPage}>
          <StyledSnackbarProvider
            anchorOrigin={{
              vertical: 'top',
              horizontal: 'center',
            }}
            preventDuplicate
            autoHideDuration={3000}
            Components={{
              info: InfoSnackbar,
              success: CustomSnackbar,
              error: CustomSnackbar,
              warning: CustomSnackbar,
              default: CustomSnackbar,
            }}
          >
            <AppConfig>
              <Suspense>
                <Component />
              </Suspense>
            </AppConfig>
          </StyledSnackbarProvider>
        </ErrorBoundary>
      </AppTheme>
    );
  };
}

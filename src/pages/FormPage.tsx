import { useParams } from 'react-router-dom';

import { FormView } from '@/components/form/FormView';
import { useAppThemeMode } from '@/components/main/useAppThemeMode';

/**
 * Public form page at `/form/:token`. Reads the URL token (the share-link
 * UUID minted by the cloud's `/form/share` endpoint) and hands it to
 * [FormView], which owns the load-render-submit flow.
 *
 * The route is anonymous-friendly: workspace-tier forms hit by an
 * unauthenticated client get an `auth_required` schema response with a
 * `login_url`, which the view renders as a sign-in prompt rather than
 * pushing the user through a generic 401 page.
 */
function FormPage({ notFoundFallback }: { notFoundFallback?: React.ReactNode }) {
  const { token } = useParams();

  // Public forms need the semantic color variables kept in sync with the
  // visitor's preferred theme, but not the authenticated app's MUI/i18n/
  // workspace provider graph.
  useAppThemeMode();

  if (!token) {
    return (
      <div data-testid='public-not-found' className='flex h-screen items-center justify-center text-text-caption'>
        Form not found
      </div>
    );
  }

  // A route-param change reuses this page instance. Remount the stateful form
  // so the previous token's schema and answers can never pair with the new
  // token before FormView's fetch effect runs.
  return <FormView key={token} token={token} notFoundFallback={notFoundFallback} />;
}

export default FormPage;

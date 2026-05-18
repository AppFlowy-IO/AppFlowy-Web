import { useParams } from 'react-router-dom';

import { FormView } from '@/components/form';
import NotFound from '@/components/error/NotFound';

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
function FormPage() {
  const { token } = useParams();

  if (!token) return <NotFound />;
  return <FormView token={token} />;
}

export default FormPage;

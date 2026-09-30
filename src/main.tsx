import ReactDOM from 'react-dom/client';

import { captureServerRenderedMarkup } from '@/components/_shared/ServerRenderedFallback';
import App from '@/components/main/App';
import './styles/global.css';

const root = document.getElementById('root')!;

// Before createRoot empties #root: keep a server-rendered published page
// visible through the route-loading fallbacks.
if (captureServerRenderedMarkup(root)) {
  // Only published pages are server-rendered, so their route chunks are known
  // now. Fetch them together rather than one after another as each lazy
  // boundary renders; React.lazy then finds them already loading. A failure
  // surfaces through those lazy boundaries, not here.
  void import('@/components/main/MainAppRoutes').catch(() => undefined);
  void import('@/pages/PublishPage').catch(() => undefined);
}

ReactDOM.createRoot(root).render(<App />);

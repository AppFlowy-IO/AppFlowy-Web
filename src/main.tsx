import ReactDOM from 'react-dom/client';

import { captureServerRenderedMarkup } from '@/components/_shared/ServerRenderedFallback';
import App from '@/components/main/App';
import './styles/global.css';

const root = document.getElementById('root')!;

// Before createRoot empties #root: keep a server-rendered published page
// visible through the route-loading fallbacks.
captureServerRenderedMarkup(root);
ReactDOM.createRoot(root).render(<App />);

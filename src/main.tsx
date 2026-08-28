import ReactDOM from 'react-dom/client';

import '@/i18n/config';
import App from '@/components/main/App';
import { registerAppflowyLinkPreviewProvider } from '@/utils/link-preview-remote';
import './styles/global.css';

registerAppflowyLinkPreviewProvider();

ReactDOM.createRoot(document.getElementById('root')!).render(<App />);

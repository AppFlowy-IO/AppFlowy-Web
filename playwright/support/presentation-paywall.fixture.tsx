import { useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Toaster } from 'sonner';

import { Role, type User, type UserWorkspaceInfo } from '@/application/types';
import { AppOperationsContext, type AppOperationsContextType } from '@/components/app/contexts/AppOperationsContext';
import { AuthInternalContext } from '@/components/app/contexts/AuthInternalContext';
import { presentationPricing } from '@/components/billing/__tests__/fixtures/presentation-pricing';
import UpgradePlan from '@/components/billing/UpgradePlan';
import { AFConfigContext } from '@/components/main/app.hooks';
import AppTheme from '@/components/main/AppTheme';
import SlideCountDropdown from '@/components/presentation/SlideCountDropdown';
import { usePresentationAccess } from '@/components/presentation/usePresentationAccess';
import { getConfigValue } from '@/utils/runtime-config';
import { updateServerInfo } from '@/utils/server-info';
import '@/styles/global.css';
import '@/components/presentation/presentation.css';

const member = new URLSearchParams(location.search).get('role') === 'member';
const user = { uid: member ? 'member' : 'owner' } as User;
const info = { workspaces: [{ id: 'workspace', role: member ? Role.Member : Role.Owner, owner: { uid: 'owner' } }] } as UserWorkspaceInfo;
const operations = { getSubscriptions: async () => [], getPricingCatalog: async () => presentationPricing } as unknown as AppOperationsContextType;

updateServerInfo(getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud'), {
  status: 'available', info: { self_hosted: false, enable_page_history: true },
});

function Fixture() {
  // Real upgrade handler/router, with status loading disabled: no auth, Cloud, or model calls.
  const { onUpgrade } = usePresentationAccess(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('Keep my presentation instructions');
  const [count, setCount] = useState(4);
  const surface = useRef<HTMLDivElement>(null);

  return <>
    <div ref={surface} role='dialog' aria-label='Presentation settings' className='ps-root bg-white p-8'>
      <label>Instructions<textarea aria-label='Instructions' value={draft} onChange={(event) => setDraft(event.target.value)} /></label>
      <SlideCountDropdown value={count} maxCount={12} disabled={false} allowed={false} onValueChange={setCount} onUpgrade={onUpgrade} />
      <button onClick={() => void surface.current?.requestFullscreen()}>Enter fullscreen</button>
    </div>
    <UpgradePlan open={open} onOpen={() => setOpen(true)} onClose={() => setOpen(false)} />
    <Toaster />
  </>;
}

createRoot(document.getElementById('root')!).render(
  <BrowserRouter><AppTheme>
    <AFConfigContext.Provider value={{ isAuthenticated: true, currentUser: user, updateCurrentUser: async () => undefined, openLoginModal: () => undefined }}>
      <AuthInternalContext.Provider value={{ currentWorkspaceId: 'workspace', userWorkspaceInfo: info, isAuthenticated: true, onChangeWorkspace: async () => undefined }}>
        <AppOperationsContext.Provider value={operations}><Fixture /></AppOperationsContext.Provider>
      </AuthInternalContext.Provider>
    </AFConfigContext.Provider>
  </AppTheme></BrowserRouter>
);

import { useState } from 'react';
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
import PresentationShell from '@/components/presentation/PresentationShell';
import SlideGenerationSetup from '@/components/presentation/SlideGenerationSetup';
import { APPFLOWY_SLIDE_THEMES } from '@/components/presentation/slide-themes';
import { usePresentationAccess } from '@/components/presentation/usePresentationAccess';
import { getConfigValue } from '@/utils/runtime-config';
import { updateServerInfo } from '@/utils/server-info';
import '@/styles/global.css';
import '@/components/presentation/presentation.css';

import type { SlidesWorkflowProps } from '@/components/presentation/SlidesWorkflow';
import type { GenerationOptions, PageSnapshot } from '@/components/presentation/types';

const query = new URLSearchParams(location.search);
const member = query.get('role') === 'member';
const user = { uid: member ? 'member' : 'owner' } as User;
const info = { workspaces: [{ id: 'workspace', role: member ? Role.Member : Role.Owner, owner: { uid: 'owner' } }] } as UserWorkspaceInfo;
const operations = { getSubscriptions: async () => [], getPricingCatalog: async () => presentationPricing } as unknown as AppOperationsContextType;
const source: PageSnapshot = {
  pageId: 'page', revision: 'revision', title: 'Project launch plan', kind: 'document',
  blocks: [], properties: [], warnings: [],
};

updateServerInfo(getConfigValue('APPFLOWY_BASE_URL', 'https://test.appflowy.cloud'), {
  status: 'available', info: { self_hosted: false, enable_page_history: true },
});

function Fixture() {
  const { onUpgrade } = usePresentationAccess(false);
  const [open, setOpen] = useState(false);
  const [openedSaved, setOpenedSaved] = useState(false);
  const [options, setOptions] = useState<GenerationOptions>({
    designMode: 'auto', slideCountMode: 'fixed', slideCountSelection: 'preset', slideCount: 12,
    audience: '', instructions: '', includeProperties: false, allowWebSearch: false,
  });
  const [style, setStyle] = useState(APPFLOWY_SLIDE_THEMES[0]);
  const remaining = Number(query.get('remaining') ?? 4);
  const props = {
    snapshot: source, options, onOptions: setOptions, style, onStyle: setStyle, styles: APPFLOWY_SLIDE_THEMES,
    canGenerate: remaining > 0, canAssess: remaining > 0, remainingSlides: remaining, maxSlides: remaining,
    isPro: false, customSlideCount: false, onUpgrade, onCancel: () => undefined, onStage: () => undefined,
    // `analysisError` stands in for a failed source analysis, which shows the Retry analysis notice.
    onPrepareGeneration: async () => { throw new Error(query.get('analysisError') ?? 'Quota-blocked setup must not prepare sources.'); },
    onGenerate: () => { throw new Error('This fixture never generates model output.'); },
    reuse: { available: query.get('cached') === 'true', checking: false, onOpen: () => setOpenedSaved(true) },
  } as SlidesWorkflowProps;

  return <>
    <PresentationShell setup onClose={() => undefined}>
      <div className='ps-root ps-studio ps-compact-setup'>
        <div className='ps-main'><main className='ps-content'>
          {openedSaved ? <p role='status'>Saved presentation opened</p> : (
            <SlideGenerationSetup props={props} scope={{ workspaceId: 'workspace', pageId: 'page' }} />
          )}
        </main></div>
      </div>
    </PresentationShell>
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

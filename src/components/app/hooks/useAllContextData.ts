import { useContext, useMemo } from 'react';
import { Awareness } from 'y-protocols/awareness';

import { AppContextType } from '@/components/app/app.hooks';

import { useAuthInternal } from '../contexts/AuthInternalContext';
import { BusinessInternalContext } from '../contexts/BusinessInternalContext';
import { SyncInternalContext } from '../contexts/SyncInternalContext';

// Hook to merge all internal context data into the complete AppContextType
// This maintains backward compatibility with the original AppContext interface
export function useAllContextData(awarenessMap: Record<string, Awareness>): AppContextType {
  const authData = useAuthInternal();
  // Use useContext directly since these may not exist when no workspace ID
  const syncData = useContext(SyncInternalContext);
  const businessData = useContext(BusinessInternalContext);


  return useMemo(() => ({
    // From AuthInternalContext
    ...authData,

    // From SyncInternalContext (may be null if no workspace ID)
    eventEmitter: syncData?.eventEmitter,
    awarenessMap: awarenessMap, // Use the awareness map from business layer
    scheduleDeferredCleanup: syncData?.scheduleDeferredCleanup,

    // From BusinessInternalContext - all business operations and state (may be null if no workspace ID)
    ...businessData,
    
    // Override fallbacks for required methods when no workspace is selected
    toView: businessData?.toView || (async () => {
      // No-op when no workspace is selected
    }),
    loadViewMeta: businessData?.loadViewMeta || (async () => {
      throw new Error('No workspace selected');
    }),
    loadView: businessData?.loadView || (async () => { 
      throw new Error('No workspace selected'); 
    }),
  }), [authData, syncData, businessData, awarenessMap]);
}
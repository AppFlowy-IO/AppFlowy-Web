const changes = new EventTarget();
const source = Math.random().toString(36);

export function notifyConnectionsChanged(workspaceId: string) {
  changes.dispatchEvent(new CustomEvent('change', { detail: workspaceId }));
  if (typeof BroadcastChannel !== 'undefined') {
    const channel = new BroadcastChannel('appflowy-integrations');

    channel.postMessage({ workspaceId, source });
    channel.close();
  }
}

export function onConnectionsChanged(workspaceId: string, callback: () => void) {
  const listener = (event: Event) => {
    if ((event as CustomEvent<string>).detail === workspaceId) callback();
  };

  changes.addEventListener('change', listener);
  const channel = typeof BroadcastChannel === 'undefined' ? undefined : new BroadcastChannel('appflowy-integrations');

  if (channel)
    channel.onmessage = (event: MessageEvent<{ workspaceId?: string; source?: string } | null>) => {
      if (event.data?.workspaceId === workspaceId && event.data.source !== source) callback();
    };

  return () => {
    changes.removeEventListener('change', listener);
    channel?.close();
  };
}

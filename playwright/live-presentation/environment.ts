function required(name: string): string {
  const value = process.env[name]?.trim();

  if (!value) throw new Error(`Set ${name} after confirming the local presentation environment.`);
  return value;
}

function loopbackOrigin(name: string): string {
  let value: URL;

  try {
    value = new URL(required(name));
  } catch {
    throw new Error(`${name} must be a valid loopback HTTP(S) origin.`);
  }

  if (
    !['http:', 'https:'].includes(value.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(value.hostname) ||
    value.username ||
    value.password ||
    value.pathname !== '/' ||
    value.search ||
    value.hash
  )
    throw new Error(`${name} must be an explicit loopback HTTP(S) origin without credentials or a path.`);
  return value.origin;
}

export function livePresentationEnvironment() {
  const workspaceId = required('PRESENTATION_LIVE_WORKSPACE_ID');
  const gatewayOrigin = loopbackOrigin('PRESENTATION_LIVE_GATEWAY_ORIGIN');

  if (loopbackOrigin('APPFLOWY_DEV_API_PROXY_TARGET') !== gatewayOrigin) {
    throw new Error('The declared Web API proxy target must equal the confirmed Gateway origin.');
  }

  if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(workspaceId)) {
    throw new Error('PRESENTATION_LIVE_WORKSPACE_ID must be the verified workspace UUID.');
  }
  return {
    webOrigin: loopbackOrigin('PRESENTATION_LIVE_WEB_ORIGIN'),
    gatewayOrigin,
    workspaceId,
    workspaceName: required('PRESENTATION_LIVE_WORKSPACE_NAME'),
    email: required('PRESENTATION_LIVE_EMAIL'),
  };
}

export function livePresentationPassword(): string {
  // The caller supplies the invoked localhost skill's password privately.
  return required('PRESENTATION_LIVE_PASSWORD');
}

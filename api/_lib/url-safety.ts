// Best-effort SSRF guard for literal private / loopback / link-local hosts.
// This does not cover hostnames that resolve to private IPs via DNS.
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    return true;
  }

  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);

    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true; // link-local + cloud metadata
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  }

  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) {
    return true;
  }

  return false;
}

export function isAllowedHttpUrl(url: URL): boolean {
  return (url.protocol === 'http:' || url.protocol === 'https:') && !isBlockedHost(url.hostname);
}

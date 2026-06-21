// Best-effort SSRF guard for literal private / loopback / link-local hosts.
// This does not cover hostnames that resolve to private IPs via DNS.
export function isBlockedHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');

  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal')) {
    return true;
  }

  const mappedV4 = parseIPv4MappedIPv6(host);

  if (mappedV4 && isBlockedIPv4(mappedV4)) {
    return true;
  }

  const v4 = parseIPv4(host);

  if (v4 && isBlockedIPv4(v4)) return true;

  if (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80')) {
    return true;
  }

  return false;
}

export function isAllowedHttpUrl(url: URL): boolean {
  return (url.protocol === 'http:' || url.protocol === 'https:') && !isBlockedHost(url.hostname);
}

function parseIPv4(host: string): [number, number, number, number] | null {
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);

  if (!v4) return null;

  const octets = [Number(v4[1]), Number(v4[2]), Number(v4[3]), Number(v4[4])] as [
    number,
    number,
    number,
    number,
  ];

  return octets.every((octet) => octet >= 0 && octet <= 255) ? octets : null;
}

function parseIPv4MappedIPv6(host: string): [number, number, number, number] | null {
  if (!host.startsWith('::ffff:')) return null;

  const embedded = host.slice('::ffff:'.length);
  const dotted = parseIPv4(embedded);

  if (dotted) return dotted;

  const parts = embedded.split(':');

  if (parts.length < 2) return null;

  const high = Number.parseInt(parts[parts.length - 2], 16);
  const low = Number.parseInt(parts[parts.length - 1], 16);

  if (!Number.isInteger(high) || !Number.isInteger(low) || high < 0 || high > 0xffff || low < 0 || low > 0xffff) {
    return null;
  }

  return [high >> 8, high & 0xff, low >> 8, low & 0xff];
}

function isBlockedIPv4([a, b]: [number, number, number, number]): boolean {
  if (a === 0 || a === 10 || a === 127) return true;
  if (a === 169 && b === 254) return true; // link-local + cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT

  return false;
}

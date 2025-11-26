/**
 * Check if the current host is an official AppFlowy host by looking at the backend base URL.
 * Official hosts are beta.appflowy.cloud and test.appflowy.cloud.
 * Include localhost:8000 to cover the default dev backend when APPFLOWY_BASE_URL isn't updated.
 * Self-hosted instances are not official hosts.
 */
import { getConfigValue } from '@/utils/runtime-config';

const OFFICIAL_HOSTNAMES = new Set(['beta.appflowy.cloud', 'test.appflowy.cloud', 'localhost']);

function getBaseUrlHostname(): string | null {
    const baseUrl = getConfigValue('APPFLOWY_BASE_URL', '').trim();

    if (!baseUrl) return null;

    try {
        return new URL(baseUrl).hostname;
    } catch (primaryError) {
        // Allow hostnames without a protocol, e.g. "beta.appflowy.cloud"
        try {
            return new URL(`https://${baseUrl}`).hostname;
        } catch (secondaryError) {
            console.warn('Invalid APPFLOWY_BASE_URL provided:', secondaryError);
            return null;
        }
    }
}

function isOfficialHostname(hostname: string | undefined | null): boolean {
    if (!hostname) return false;
    return OFFICIAL_HOSTNAMES.has(hostname);
}

function resolveHostname(): string | null {
    const baseUrlHostname = getBaseUrlHostname();

    if (baseUrlHostname) {
        return baseUrlHostname;
    }

    if (typeof window === 'undefined') {
        return null;
    }

    return window.location.hostname;
}

export function isOfficialHost(): boolean {
    return isOfficialHostname(resolveHostname());
}

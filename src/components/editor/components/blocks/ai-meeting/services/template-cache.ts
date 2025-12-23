import { SummaryTemplateResult } from './types';

const CACHE_KEY = 'ai_meeting_summary_templates';
const CACHE_EXPIRY_KEY = 'ai_meeting_summary_templates_expiry';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

interface CachedTemplates {
  data: SummaryTemplateResult;
  timestamp: number;
}

/**
 * Get cached templates from localStorage
 */
export function getCachedTemplates(): SummaryTemplateResult | null {
  try {
    const cached = localStorage.getItem(CACHE_KEY);

    if (!cached) return null;

    const parsed: CachedTemplates = JSON.parse(cached);

    // Return cached data regardless of expiry (stale-while-revalidate)
    return parsed.data;
  } catch (e) {
    console.warn('[TemplateCache] Failed to read cache:', e);
    return null;
  }
}

/**
 * Check if cached templates are expired (should revalidate)
 */
export function isCacheExpired(): boolean {
  try {
    const expiryStr = localStorage.getItem(CACHE_EXPIRY_KEY);

    if (!expiryStr) return true;

    const expiry = parseInt(expiryStr, 10);

    return Date.now() > expiry;
  } catch {
    return true;
  }
}

/**
 * Save templates to localStorage cache
 */
export function setCachedTemplates(templates: SummaryTemplateResult): void {
  try {
    const cached: CachedTemplates = {
      data: templates,
      timestamp: Date.now(),
    };

    localStorage.setItem(CACHE_KEY, JSON.stringify(cached));
    localStorage.setItem(CACHE_EXPIRY_KEY, String(Date.now() + CACHE_TTL_MS));
  } catch (e) {
    console.warn('[TemplateCache] Failed to write cache:', e);
  }
}

/**
 * Clear the templates cache
 */
export function clearTemplateCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY);
    localStorage.removeItem(CACHE_EXPIRY_KEY);
  } catch (e) {
    console.warn('[TemplateCache] Failed to clear cache:', e);
  }
}

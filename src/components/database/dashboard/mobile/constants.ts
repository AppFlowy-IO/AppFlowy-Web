/**
 * A phone tool keeps the 24px visual of a widget tool and gets a 40×40 hit
 * area (WP14 §1.4.4): the pseudo-element reaches 8px past each edge of the
 * (relative) button.
 */
export const MOBILE_TOOL_HIT_AREA_CLASS = "before:absolute before:-inset-2 before:content-['']";

// Shared NormalModal prop constants to avoid per-render object allocations
export const MODAL_CLASSES = { container: 'items-start max-md:mt-auto max-md:items-center mt-[10%]' } as const;
export const MODAL_PAPER_PROPS = { sx: { width: 500 } } as const;
export const HIDDEN_BUTTON_PROPS = { className: 'hidden' } as const;

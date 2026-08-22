import { SpaceVisibility } from '@/application/types';

// Open and Closed depend on space discovery, which is not available in the
// clients yet. Keep those enum values for existing server data, but do not
// offer them as new selections.
export const SELECTABLE_SPACE_VISIBILITIES = [SpaceVisibility.Default, SpaceVisibility.Private] as const;

export const SELECTABLE_SPACE_VISIBILITIES_WITHOUT_DEFAULT = [SpaceVisibility.Private] as const;

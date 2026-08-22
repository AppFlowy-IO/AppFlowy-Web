import { SpaceVisibility } from '@/application/types';

// Default is the wire value for a public space. Open and Closed remain valid
// for existing server data, but new client choices use the public/private model.
export const SELECTABLE_SPACE_VISIBILITIES = [SpaceVisibility.Default, SpaceVisibility.Private] as const;

export interface AppOutlineResponse {
  outline: import('@/application/types').View[];
  folderRid?: string;
}

export interface AFCloudConfig {
  baseURL: string;
  gotrueURL: string;
  wsURL: string;
}

export interface WorkspaceMemberProfileUpdate {
  name: string;
  avatar_url?: string;
  cover_image_url?: string;
  custom_image_url?: string;
  description?: string;
}

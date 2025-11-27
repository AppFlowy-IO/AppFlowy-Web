import path from 'path';

export const distDir = path.join(__dirname, 'dist');
export const indexPath = path.join(distDir, 'index.html');
export const baseURL = process.env.APPFLOWY_BASE_URL as string;
// Used when a namespace is requested without /publishName; users get redirected to the
// public marketing site if the namespace segment is empty (see redirect in publish route).
export const defaultSite = 'https://appflowy.com';

import fs from 'fs';
import path from 'path';

// In production, dist is copied to deploy/dist. In dev, it's at project root.
const prodDistDir = path.join(__dirname, 'dist');
const devDistDir = path.join(__dirname, '..', 'dist');

export const distDir = fs.existsSync(prodDistDir) ? prodDistDir : devDistDir;
export const indexPath = path.join(distDir, 'index.html');
export const baseURL = process.env.APPFLOWY_BASE_URL as string;
// Used when a namespace is requested without /publishName; users get redirected to the
// public marketing site if the namespace segment is empty (see redirect in publish route).
export const defaultSite = 'https://appflowy.com';

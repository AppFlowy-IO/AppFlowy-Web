import { readFileSync } from 'fs';
import { join } from 'path';

import { readParityFile } from '@/application/database-yjs/__tests__/dashboard-parity-helpers';

const APP_ILLUSTRATION = join(__dirname, '..', '..', '..', '..', 'assets', 'icons', 'dashboard_empty_illustration.svg');

describe('dashboard parity assets', () => {
  // WP06 §1.9: the empty dashboard illustration is byte-identical in the fixture and in each client.
  it('ships the empty dashboard illustration byte for byte', () => {
    expect(readFileSync(APP_ILLUSTRATION).equals(readParityFile('assets/empty-dashboard.svg'))).toBe(true);
  });

  it('draws the illustration only with currentColor, at 288 by 112', () => {
    const svg = readParityFile('assets/empty-dashboard.svg').toString('utf8');

    expect(svg).toMatch(/^<svg [^>]*width="288" height="112" viewBox="0 0 288 112"/);
    expect(svg.match(/#[0-9a-fA-F]{3,8}\b/g)).toBeNull();
    expect(svg.endsWith('</svg>\n')).toBe(true);
  });
});

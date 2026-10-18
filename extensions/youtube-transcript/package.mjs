import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const directory = fileURLToPath(new URL('.', import.meta.url));
const output = fileURLToPath(new URL('../../public/downloads/appflowy-youtube-transcript.zip', import.meta.url));

mkdirSync(fileURLToPath(new URL('../../public/downloads/', import.meta.url)), { recursive: true });
rmSync(output, { force: true });
execFileSync('zip', ['-X', '-q', output, 'manifest.json', 'background.js', 'policy.js', 'content.js', 'marker.js', 'rules.json', 'playback.js', 'playback-policy.js', 'playback-content.js', 'playback-hook.js', 'README.md'], { cwd: directory });
process.stdout.write(`Created ${output}\n`);

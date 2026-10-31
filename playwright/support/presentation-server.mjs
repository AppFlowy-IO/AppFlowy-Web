import { createServer } from 'vite';

// Test-only frontend harness. Scan all browser fixtures before serving so a
// first-use dependency cannot reload the page in the middle of fullscreen or navigation.
const server = await createServer({
  cacheDir: 'node_modules/.vite/presentation-tests',
  optimizeDeps: {
    entries: ['playwright/support/presentation-*.fixture.tsx', 'playwright/support/document-*.fixture.tsx'],
  },
  server: { host: '127.0.0.1', port: 5183, strictPort: true },
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, async () => {
    await server.close();
    process.exit(0);
  });
}

await server.listen();
server.printUrls();

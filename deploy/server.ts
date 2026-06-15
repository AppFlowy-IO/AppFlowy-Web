import { baseURL } from './config';
import { logger } from './logger';
import { routes } from './routes';

export type RequestContext = {
  req: Request;
  url: URL;
  hostname: string | null;
  logger: typeof logger;
};

export const createServer = async (req: Request) => {
  const reqUrl = new URL(req.url);
  const hostname = req.headers.get('host');

  if (!reqUrl.pathname.startsWith('/health')) {
    logger.info(`Request URL: ${hostname}${reqUrl.pathname}`);
  }

  if (reqUrl.pathname === '/') {
    return new Response(null, {
      status: 302,
      headers: {
        Location: '/app',
      },
    });
  }

  const context: RequestContext = {
    req,
    url: reqUrl,
    hostname,
    logger,
  };

  for (const route of routes) {
    const response = await route(context);

    if (response) {
      return response;
    }
  }

  return new Response('Not Found', { status: 404 });
};

declare const Bun: {
  serve: (options: { port: number; fetch: typeof createServer; error: (err: Error) => Response }) => void;
};

export const start = () => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    Bun.serve({
      port: 3000,
      fetch: createServer,
      error: (err) => {
        logger.error(`Internal Server Error: ${err}`);
        return new Response('Internal Server Error', { status: 500 });
      },
    });
    logger.info('Server is running on port 3000');
    logger.info(`Base URL: ${baseURL}`);
  } catch (err) {
    logger.error(err);
    process.exit(1);
  }
};

if (process.env.NODE_ENV !== 'test') {
  start();
}

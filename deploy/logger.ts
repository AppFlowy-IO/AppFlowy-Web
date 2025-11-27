import pino from 'pino';

const prettyTransport = {
  target: 'pino-pretty',
  options: {
    colorize: true,
    translateTime: 'SYS:standard',
  },
};

export const logger = pino({
  transport: process.env.NODE_ENV === 'production' ? undefined : prettyTransport,
  level: process.env.LOG_LEVEL || 'info',
});

// Request timing logic removed – we only keep the shared logger here.

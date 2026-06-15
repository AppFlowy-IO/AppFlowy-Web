// @ts-expect-error no bun
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
import { fetch } from 'bun';

import { baseURL } from './config';
import { logger } from './logger';

export const fetchPublishMetadata = async (namespace: string, publishName?: string) => {
  const encodedNamespace = encodeURIComponent(namespace);
  let url = `${baseURL}/api/workspace/published/${encodedNamespace}`;

  if (publishName) {
    url = `${baseURL}/api/workspace/v1/published/${encodedNamespace}/${encodeURIComponent(publishName)}`;
  }

  logger.debug(`Fetching meta data from ${url}`);

  const response = await fetch(url, {
    verbose: false,
  });

  if (!response.ok) {
    throw new Error(`HTTP error! Status: ${response.status}`);
  }

  const data = await response.json();

  logger.debug(`Fetched meta data from ${url}: ${JSON.stringify(data)}`);

  return data;
};

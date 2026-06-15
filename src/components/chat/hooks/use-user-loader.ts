import { useCallback, useRef } from 'react';

import { useChatContext } from '@/components/chat/chat/context';
import { User } from '@/components/chat/types';

export function useUserLoader() {
  const users = useRef<
    Map<string, Promise<User>>
  >(new Map());

  const {
    requestInstance,
  } = useChatContext();

  // Make sure to cache the user to avoid fetching the same user multiple times
  const fetchMember = useCallback(async(uuid: string) => {

    // Check if the user is already being fetched
    const existingRequest = users.current.get(uuid);

    if(existingRequest) {
      return existingRequest;
    }

    const promise = (async() => {
      try {
        const user = await requestInstance.getMember(uuid);

        // Cache the user
        users.current.set(uuid, Promise.resolve(user));
        return user;
      } catch(error) {
        // Remove the user from the cache
        users.current.delete(uuid);
        throw error;
      }
    })();

    // Cache the promise
    users.current.set(uuid, promise);

    return promise;
  }, [requestInstance]);

  return {
    fetchMember,
  };
}
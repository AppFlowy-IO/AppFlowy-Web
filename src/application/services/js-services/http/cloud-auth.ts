import { APIResponse, executeAPIRequest, getAxios } from './core';

export async function verifyToken(accessToken: string) {
  const url = `/api/user/verify/${accessToken}`;

  return executeAPIRequest<{ is_new: boolean }>(() =>
    getAxios()?.get<APIResponse<{ is_new: boolean }>>(url)
  );
}

export interface ParkApi {
  get<T>(suffix: string): Promise<T>
  send<T>(suffix: string, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', body?: unknown): Promise<T>
}

export function createParkApi(orgId: string): ParkApi {
  const base = `/park/api/v1/parks/${encodeURIComponent(orgId)}`
  async function request<T>(suffix: string, method: string, body?: unknown): Promise<T> {
    const response = await fetch(`${base}/${suffix}`, {
      method,
      credentials: 'include',
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    if (!response.ok) throw new Error(`${response.status}`)
    if (response.status === 204) return undefined as T
    return response.json() as Promise<T>
  }
  return {
    get: (suffix) => request(suffix, 'GET'),
    send: (suffix, method, body) => request(suffix, method, body),
  }
}

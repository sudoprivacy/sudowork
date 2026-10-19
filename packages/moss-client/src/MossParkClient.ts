import {
  MossNetworkError,
  type MossCallContext,
  type MossRequestMethod,
} from "./MossHttpClient.js";

export interface MossParkResponse {
  status: number;
  body: string;
}

/** Park API port: use the token and Moss origin bound to the current session. */
export class MossParkClient {
  async request(
    context: MossCallContext,
    path: string,
    method: MossRequestMethod,
    body?: unknown,
  ): Promise<MossParkResponse> {
    if (!path.startsWith("/api/v1/parks/"))
      throw new Error("Invalid park API path");
    const url = new URL(path, context.baseUrl);
    if (
      url.origin !== new URL(context.baseUrl).origin ||
      !url.pathname.startsWith("/api/v1/parks/")
    )
      throw new Error("Invalid park API path");
    try {
      const response = await fetch(url, {
        method,
        headers: {
          authorization: `Bearer ${context.accessToken}`,
          ...(body === undefined ? {} : { "content-type": "application/json" }),
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      return { status: response.status, body: await response.text() };
    } catch (error) {
      throw new MossNetworkError(path, error);
    }
  }
}

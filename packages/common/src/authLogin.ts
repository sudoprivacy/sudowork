import type { IMossExecutionCapabilities, TMossLocalRuntimeStatus } from './mossExecution.js';

export type LoginGrant =
  | { grant_type: 'phone'; phone: string; code: string }
  | {
      grant_type: 'phone_register';
      phone: string;
      code: string;
      nickname: string;
      invitation_code: string;
    }
  | { grant_type: 'password'; username: string; password: string }
  | { grant_type: 'api_key'; api_key: string }
  | { grant_type: 'oauth2'; params: Record<string, string> };

export type LoginRequest = LoginGrant & { mossBaseUrl?: string };
export type LoginSessionType = 'phone' | 'password' | 'api_key' | 'oauth2';

export interface IAuthenticatedLogin {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  user: {
    id: string;
    name: string;
    role: string;
    orgId: string;
    localAuth: boolean;
  };
  execution?: IMossExecutionCapabilities;
  localRuntime?: TMossLocalRuntimeStatus;
  sudorouter_key?: string;
  model_service_url?: string;
  models?: string[];
  scode_auto_model?: string;
}

export interface ILoginResponse {
  success: boolean;
  data?: IAuthenticatedLogin;
  error?: string;
  msg?: string;
}

export interface ILoginSession {
  data: IAuthenticatedLogin;
  deviceId: string;
  sessionType: LoginSessionType;
  expiresAt: number;
  isLocalAvailable: boolean;
}

export type LoginFailureCode = 'invalidCredentials' | 'networkError' | 'timeout' | 'invalidResponse' | 'setupError';

export class LoginError extends Error {
  constructor(
    readonly code: LoginFailureCode,
    readonly serverError?: string,
    readonly serverMessage?: string
  ) {
    super(code);
    this.name = 'LoginError';
  }
}

export const LOGIN_TIMEOUT_MS = 45_000;

/** Bounds the entire attempt, including IPC and persistence, not just HTTP. */
export class LoginAttempt {
  private readonly controller = new AbortController();
  private readonly timer: ReturnType<typeof setTimeout>;
  private stage = 'authenticate';

  constructor(timeoutMs = LOGIN_TIMEOUT_MS) {
    this.timer = setTimeout(() => this.controller.abort(new LoginError('timeout')), timeoutMs);
  }

  get signal(): AbortSignal {
    return this.controller.signal;
  }

  get currentStage(): string {
    return this.stage;
  }

  /** Ignore late results and prevent subsequent writes after an expired attempt. */
  async step<T>(stage: string, action: (signal: AbortSignal) => Promise<T>): Promise<T> {
    this.signal.throwIfAborted();
    this.stage = stage;
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => reject(this.signal.reason);
      this.signal.addEventListener('abort', onAbort, { once: true });
      Promise.resolve()
        .then(() => {
          this.signal.throwIfAborted();
          return action(this.signal);
        })
        .then(
          (value) => {
            this.signal.removeEventListener('abort', onAbort);
            if (this.signal.aborted) reject(this.signal.reason);
            else resolve(value);
          },
          (error: unknown) => {
            this.signal.removeEventListener('abort', onAbort);
            reject(error);
          }
        );
    });
  }

  dispose(): void {
    clearTimeout(this.timer);
  }
}

export interface ILoginPort {
  authenticate: (request: LoginRequest, deviceId: string, attempt: LoginAttempt) => Promise<ILoginResponse>;
  prepareSession?: (session: ILoginSession, attempt: LoginAttempt) => Promise<void>;
}

/** One login transaction for every grant and host. Hosts supply only transport and local setup. */
export async function runLogin(
  request: LoginRequest,
  deviceId: string,
  port: ILoginPort,
  commit: (session: ILoginSession) => void,
  options: {
    timeoutMs?: number;
    onFailure?: (code: LoginFailureCode, stage: string) => void;
  } = {}
): Promise<{ success: true } | { success: false; code: LoginFailureCode; error?: string; message?: string }> {
  const attempt = new LoginAttempt(options.timeoutMs);
  try {
    const result = await attempt.step('authenticate', () => port.authenticate(request, deviceId, attempt));
    if (!result.success) {
      throw new LoginError(result.error === 'network_error' ? 'networkError' : 'invalidCredentials', result.error, result.msg);
    }
    const data = result.data;
    if (!data?.access_token || typeof data.user?.id !== 'string' || !data.user.id.trim()) throw new LoginError('invalidResponse');
    const session: ILoginSession = {
      data,
      deviceId,
      sessionType: request.grant_type === 'phone_register' ? 'phone' : request.grant_type,
      expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
      isLocalAvailable: data.execution?.isLocalAllowed ?? !!(data.user.localAuth && data.sudorouter_key && data.model_service_url && data.models?.length),
    };
    if (port.prepareSession) await attempt.step('prepare-session', () => port.prepareSession!(session, attempt));
    attempt.signal.throwIfAborted();
    commit(session);
    return { success: true };
  } catch (error) {
    const failure = error instanceof LoginError ? error : new LoginError('networkError');
    options.onFailure?.(failure.code, attempt.currentStage);
    return {
      success: false,
      code: failure.code,
      error: failure.serverError,
      message: failure.serverMessage,
    };
  } finally {
    attempt.dispose();
  }
}

export const API_BASE =
  import.meta.env.VITE_API_BASE ?? "http://127.0.0.1:8000";

const REQUEST_TIMEOUT_MS = 12_000;
const RETRY_DELAYS_MS = [350, 900];

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export async function apiJson<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const method = (options.method ?? "GET").toUpperCase();
  const maxAttempts = method === "GET" ? RETRY_DELAYS_MS.length + 1 : 1;
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    const abortFromCaller = () => controller.abort();
    options.signal?.addEventListener("abort", abortFromCaller, { once: true });

    try {
      const res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: {
          "Content-Type": "application/json",
          ...(options.headers ?? {}),
        },
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text();
        const retryable = res.status === 429 || res.status >= 500;
        if (retryable && attempt + 1 < maxAttempts) {
          await wait(RETRY_DELAYS_MS[attempt]);
          continue;
        }
        let message = text || `Request failed: ${res.status}`;
        try {
          const payload = JSON.parse(text) as { detail?: string };
          if (payload.detail) message = payload.detail;
        } catch {
          // Keep the plain response body when it is not JSON.
        }
        throw new Error(message);
      }

      if (res.status === 204) return undefined as T;
      return res.json() as Promise<T>;
    } catch (error) {
      lastError = error;
      const retryable = error instanceof TypeError || (error instanceof DOMException && error.name === "AbortError");
      if (!retryable || attempt + 1 >= maxAttempts) throw error;
      await wait(RETRY_DELAYS_MS[attempt]);
    } finally {
      window.clearTimeout(timeout);
      options.signal?.removeEventListener("abort", abortFromCaller);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Request failed.");
}

import type { LlRequest, LlResponse } from './protocol';

export type SendFn = (msg: LlRequest) => Promise<unknown>;

/**
 * Content-script side. Wraps runtime.sendMessage and never throws: transport failures
 * (e.g. "Extension context invalidated" after the extension is reloaded) become { ok: false }.
 */
export async function sendLl<T>(send: SendFn, msg: LlRequest, timeoutMs = 5000): Promise<LlResponse<T>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const res = await Promise.race([
      send(msg),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`no response within ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
    if (res && typeof res === 'object' && 'ok' in res) return res as LlResponse<T>;
    return { ok: false, error: 'empty or malformed response from background' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

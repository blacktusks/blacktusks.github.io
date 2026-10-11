import { createClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../config';

// "Stay signed in" decides where the session lives. On: this device remembers
// the member until they sign out. Off: the session ends when the app or tab is
// closed. Storage can be unavailable (private windows), so every call is guarded.
const STAY_KEY = 'black-tusk-stay';
const guard = <T,>(fn: () => T, fallback: T): T => { try { return fn(); } catch { return fallback; } };
export const stay = {
  get: (): boolean => guard(() => localStorage.getItem(STAY_KEY), null) !== '0',
  set(on: boolean) { guard(() => localStorage.setItem(STAY_KEY, on ? '1' : '0'), undefined); },
};
const sessionStore = {
  getItem: (key: string) => guard(() => (stay.get() ? localStorage : sessionStorage).getItem(key), null),
  setItem(key: string, value: string) {
    guard(() => {
      const [keep, drop] = stay.get() ? [localStorage, sessionStorage] : [sessionStorage, localStorage];
      keep.setItem(key, value); drop.removeItem(key);
    }, undefined);
  },
  removeItem(key: string) { guard(() => { localStorage.removeItem(key); sessionStorage.removeItem(key); }, undefined); },
};

export const supabase = createClient(SUPABASE_URL || 'http://localhost:54321', SUPABASE_ANON_KEY || 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'black-tusk-session', storage: sessionStore },
});

/** Call the clan-api server function and unwrap its error message. */
export async function api<T = any>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('clan-api', { body: { action, ...body } });
  if (error) {
    let message = error.message;
    try {
      const payload = await (error as any).context?.json?.();
      if (payload?.error) message = payload.error;
    } catch { /* keep the generic message */ }
    // The session was ended somewhere else (password reset, signed out everywhere).
    // Drop it here too, so the app returns to the sign-in screen instead of failing again.
    if ((error as any).context?.status === 401) {
      await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
      message = 'You have been signed out. Sign in again to carry on.';
    }
    throw new Error(message);
  }
  return data as T;
}

export const itemImageUrl = (path: string) => supabase.storage.from('item-images').getPublicUrl(path).data.publicUrl;

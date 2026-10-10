import { createClient } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from '../config';

export const supabase = createClient(SUPABASE_URL || 'http://localhost:54321', SUPABASE_ANON_KEY || 'missing', {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: 'black-tusk-session' },
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
    throw new Error(message);
  }
  return data as T;
}

export const itemImageUrl = (path: string) => supabase.storage.from('item-images').getPublicUrl(path).data.publicUrl;

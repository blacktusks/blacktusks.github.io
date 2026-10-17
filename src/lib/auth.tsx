import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { LOGIN_EMAIL_DOMAIN } from '../config';
import { stay, supabase } from './supabase';
import type { Profile } from './types';
import { leaveApp, startSeen, stopSeen } from './seen';
import { startSide } from './clan';

interface AuthState {
  ready: boolean;
  profile: Profile | null;
  signIn: (username: string, password: string, staySignedIn?: boolean) => Promise<void>;
  /** After a member changes their own password: Supabase ends every session, so start a new one. */
  renew: (newPassword: string) => Promise<void>;
  signOut: () => Promise<void>;
  reload: () => Promise<void>;
}
const Ctx = createContext<AuthState>(null as unknown as AuthState);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);

  const load = useCallback(async (userId: string | undefined) => {
    if (!userId) { setProfile(null); return; }
    const { data, error } = await supabase.rpc('my_profile');
    if (error) return;                                                            // offline: keep what we have
    if (!data?.id) { await supabase.auth.signOut(); setProfile(null); return; }   // account was removed
    startSide((data as Profile).id, (data as Profile).clans);     // a member starts on their own clan's side
    setProfile(data as Profile);
  }, []);

  useEffect(() => {
    let live = true;
    supabase.auth.getSession().then(async ({ data }) => {
      await load(data.session?.user.id).catch(() => undefined);
      if (live) setReady(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_OUT') setProfile(null);
      if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') setTimeout(() => load(session?.user.id), 0);
    });
    return () => { live = false; sub.subscription.unsubscribe(); };
  }, [load]);

  // Signed in: the app says so once a minute, which is how the Members screen knows who is on the app.
  const signedIn = !!profile;
  useEffect(() => { if (signedIn) startSeen(); else stopSeen(); return stopSeen; }, [signedIn]);

  const value = useMemo<AuthState>(() => ({
    ready, profile,
    async signIn(username, password, staySignedIn = true) {
      const name = username.trim().toLowerCase();                 // "Grug" and "grug" are the same member
      stay.set(staySignedIn);                                     // decided before the session is stored
      const { data, error } = await supabase.auth.signInWithPassword({ email: `${name}@${LOGIN_EMAIL_DOMAIN}`, password });
      if (error) {
        throw new Error(/invalid/i.test(error.message)
          ? 'That name and password do not match. Check both, or ask the Forgemaster to reset your password.'
          : 'Could not reach the stronghold. Check your connection and try again.');
      }
      await load(data.user?.id);
    },
    async renew(newPassword) {
      const email = (await supabase.auth.getSession()).data.session?.user.email;
      const { data, error } = email
        ? await supabase.auth.signInWithPassword({ email, password: newPassword })
        : { data: null, error: new Error('no session') };
      if (error) { await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined); setProfile(null); return; }
      await load(data?.user?.id);
    },
    // "local": signing out here leaves the member's other devices signed in.
    async signOut() { stopSeen(); await leaveApp(); await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined); setProfile(null); },
    async reload() { const { data } = await supabase.auth.getSession(); await load(data.session?.user.id); },
  }), [ready, profile, load]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

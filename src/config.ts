// Where the app finds its backend. Set these in .env (see .env.example);
// both values are safe to publish: access is enforced by the database rules.
export const SUPABASE_URL: string = import.meta.env.VITE_SUPABASE_URL ?? '';
export const SUPABASE_ANON_KEY: string = import.meta.env.VITE_SUPABASE_ANON_KEY ?? '';

// Members sign in with a name; behind the scenes it becomes name@<this>.
// Must match LOGIN_EMAIL_DOMAIN in the clan-api function.
export const LOGIN_EMAIL_DOMAIN: string = import.meta.env.VITE_LOGIN_EMAIL_DOMAIN ?? 'blacktusk.invalid';

declare const __APP_VERSION__: string;
export const APP_VERSION: string = __APP_VERSION__;
export const CONFIGURED = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

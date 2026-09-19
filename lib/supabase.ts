import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * This app shares its Supabase project with the existing wedding-invitation
 * site (C:\Coding\wedding-invitation). That site's tables live in a custom
 * `married` schema; everything this app creates (see
 * supabase/migrations/0001_init.sql) lives in the default `public` schema,
 * so the two coexist without collisions.
 */

/**
 * Server-only Supabase client — uses the service role key, which bypasses
 * RLS. NEVER import this from a Client Component or expose it to the
 * browser. Use it from Route Handlers / Server Components only.
 */
export function createServerSupabaseClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY env vars.');
  }

  return createClient(url, serviceRoleKey, {
    db: { schema: 'public' },
    auth: { persistSession: false },
  });
}

/**
 * Browser-safe Supabase client — uses the public anon key. Needed for the
 * admin login form (Supabase Auth email/password) and any future
 * browser-side calls guarded by RLS.
 *
 * NOT YET CONFIGURED: this project's existing .env.local only has
 * SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (server-only). Grab the anon
 * key from the Supabase dashboard (Project Settings → API) and set
 * NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY before the
 * admin login page is wired up.
 */
export function createBrowserSupabaseClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY env vars.'
    );
  }

  return createClient(url, anonKey);
}

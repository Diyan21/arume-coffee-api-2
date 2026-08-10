import { createClient } from '@supabase/supabase-js';

/**
 * Creates or retrieves a Supabase client configured with the service role key.
 * Service role key is kept strictly on the backend and never exposed to clients.
 * 
 * @param {Object} env - Environment object from Cloudflare Workers context (c.env)
 * @returns {Object|null} Supabase client instance or null if credentials missing
 */
export const getSupabaseClient = (env = {}) => {
  const url = env.SUPABASE_URL || (typeof process !== 'undefined' ? process.env.SUPABASE_URL : undefined);
  const key = env.SUPABASE_SERVICE_ROLE_KEY || (typeof process !== 'undefined' ? process.env.SUPABASE_SERVICE_ROLE_KEY : undefined);

  if (!url || !key) {
    return null;
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
};

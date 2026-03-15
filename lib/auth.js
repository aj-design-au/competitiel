'use strict';

const { createClient } = require('@supabase/supabase-js');

let _client = null;

function getAnonClient() {
  if (!_client) {
    const url     = process.env.SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      throw new Error('SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env');
    }
    _client = createClient(url, anonKey, {
      auth: { persistSession: false },
    });
  }
  return _client;
}

/**
 * Express middleware that validates Supabase JWT tokens.
 * Reads the token from the Authorization: Bearer <token> header.
 * Sets req.user on success. Returns 401 on failure.
 */
async function requireAuth(req, res, next) {
  const authHeader = req.headers['authorization'] || '';
  if (!authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing or invalid Authorization header' });
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  try {
    const sb = getAnonClient();
    const { data: { user }, error } = await sb.auth.getUser(token);
    if (error || !user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }
    req.user = user;
    next();
  } catch (err) {
    console.error('[auth] Error validating token:', err.message);
    return res.status(401).json({ error: 'Authentication error' });
  }
}

module.exports = { requireAuth };

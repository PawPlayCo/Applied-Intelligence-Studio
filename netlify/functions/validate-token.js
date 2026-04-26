// netlify/functions/validate-token.js
//
// Called by the guide page on every load.
// Checks that the token:
//   1. Has a valid HMAC signature (wasn't forged)
//   2. Exists in Supabase (was actually issued for a real purchase)
//   3. Hasn't been revoked
//   4. Hasn't expired (if expires_at is set)
//
// Returns 200 { valid: true, email } on success.
// Returns 401 { valid: false, reason } on any failure.
//
// Required Netlify environment variables:
//   TOKEN_SECRET          — same value used in ls-webhook.js
//   SUPABASE_URL
//   SUPABASE_SERVICE_KEY

const crypto = require('crypto');

exports.handler = async (event) => {
  // CORS headers — required so your guide page (different URL) can call this
  const cors = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  // Handle OPTIONS preflight
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: JSON.stringify({ valid: false, reason: 'Method not allowed' }) };
  }

  let token;
  try {
    ({ token } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ valid: false, reason: 'Invalid request' }) };
  }

  if (!token || typeof token !== 'string') {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ valid: false, reason: 'No token provided' }) };
  }

  // ── 1. Verify HMAC signature ──────────────────────────────
  // Token format: randomPart.signature
  // If anyone tampers with the token or tries a random string, this fails.
  const parts = token.split('.');
  if (parts.length !== 2) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ valid: false, reason: 'Malformed token' }) };
  }

  const [randomPart, providedSig] = parts;
  const expectedSig = crypto
    .createHmac('sha256', process.env.TOKEN_SECRET)
    .update(randomPart)
    .digest('hex');

  // timingSafeEqual prevents timing attacks
  let sigValid = false;
  try {
    sigValid = crypto.timingSafeEqual(
      Buffer.from(providedSig, 'hex'),
      Buffer.from(expectedSig, 'hex')
    );
  } catch {
    // Buffer lengths differ = definitely invalid
    sigValid = false;
  }

  if (!sigValid) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ valid: false, reason: 'Invalid token' }) };
  }

  // ── 2. Look up token in Supabase ──────────────────────────
  const res = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/access_tokens?token=eq.${encodeURIComponent(token)}&select=email,revoked,expires_at`,
    {
      headers: {
        'apikey':        process.env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      },
    }
  );

  if (!res.ok) {
    console.error('Supabase lookup failed:', res.status);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ valid: false, reason: 'Server error' }) };
  }

  const rows = await res.json();

  if (!rows.length) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ valid: false, reason: 'Token not found' }) };
  }

  const { email, revoked, expires_at } = rows[0];

  // ── 3. Check revocation ───────────────────────────────────
  if (revoked) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ valid: false, reason: 'Access revoked' }) };
  }

  // ── 4. Check expiry ───────────────────────────────────────
  if (expires_at && new Date(expires_at) < new Date()) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ valid: false, reason: 'Token expired' }) };
  }

  // ── 5. Update last accessed timestamp (fire-and-forget) ───
  // Don't await — don't let this slow down page loads
  fetch(
    `${process.env.SUPABASE_URL}/rest/v1/access_tokens?token=eq.${encodeURIComponent(token)}`,
    {
      method: 'PATCH',
      headers: {
        'apikey':        process.env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
        'Content-Type':  'application/json',
        'Prefer':        'return=minimal',
      },
      body: JSON.stringify({ accessed_at: new Date().toISOString() }),
    }
  ).catch(() => {}); // silently ignore if this fails

  // ── All checks passed ─────────────────────────────────────
  return {
    statusCode: 200,
    headers: cors,
    body: JSON.stringify({ valid: true, email }),
  };
};

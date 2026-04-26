// netlify/functions/ls-webhook.js
//
// Receives POST from Lemon Squeezy when an order is completed.
// 1. Validates the webhook signature (proves it's really from LS)
// 2. Checks for duplicate order (idempotency)
// 3. Generates a signed access token
// 4. Stores it in Supabase
// 5. Emails the buyer their access link via Resend
//
// Required Netlify environment variables:
//   LS_WEBHOOK_SECRET     — from Lemon Squeezy → Settings → Webhooks
//   SUPABASE_URL          — your Supabase project URL
//   SUPABASE_SERVICE_KEY  — your Supabase service_role key (NOT anon key)
//   RESEND_API_KEY        — from resend.com
//   FROM_EMAIL            — e.g. "Your Business <hello@yourdomain.com>"
//   GUIDE_URL             — e.g. "https://yourdomain.com/guide"
//   TOKEN_SECRET          — any long random string (used to sign tokens)
//                           Generate one: openssl rand -hex 32

const crypto = require('crypto');

exports.handler = async (event) => {
  // ── Only accept POST ──────────────────────────────────────
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const rawBody = event.body;

  // ── 1. Verify Lemon Squeezy webhook signature ─────────────
  // LS signs every webhook with HMAC-SHA256 using your webhook secret.
  // If this check fails, someone is sending fake webhooks to your endpoint.
  const lsSignature = event.headers['x-signature'] || event.headers['X-Signature'];
  if (!lsSignature) {
    console.error('Missing X-Signature header');
    return { statusCode: 401, body: 'Unauthorized' };
  }

  const expectedSig = crypto
    .createHmac('sha256', process.env.LS_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(lsSignature), Buffer.from(expectedSig))) {
    console.error('Invalid webhook signature');
    return { statusCode: 401, body: 'Invalid signature' };
  }

  // ── 2. Parse the event ────────────────────────────────────
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  // Only process completed orders — ignore refunds, subscriptions, etc.
  const eventName = payload.meta?.event_name;
  if (eventName !== 'order_created') {
    console.log(`Ignoring event type: ${eventName}`);
    return { statusCode: 200, body: 'Ignored' };
  }

  const orderId    = String(payload.data?.id);
  const attributes = payload.data?.attributes || {};
  const email      = attributes.user_email;
  const firstName  = attributes.user_name?.split(' ')[0] || 'there';
  const variantId  = String(attributes.first_order_item?.variant_id || '');

  // Route to the correct guide based on which product was purchased.
  // Add a VARIANT_[id]_URL env var in Netlify for each product variant.
  // Falls back to GUIDE_URL if no specific mapping exists.
  const guideUrl = (variantId && process.env[`VARIANT_${variantId}_URL`])
    || process.env.GUIDE_URL;

  console.log(`Order ${orderId} — variant ${variantId} — routing to ${guideUrl}`);

  if (!email || !orderId) {
    console.error('Missing email or order ID in payload:', JSON.stringify(payload));
    return { statusCode: 400, body: 'Missing required fields' };
  }

  // ── 3. Check for duplicate order (idempotency) ────────────
  // Lemon Squeezy can occasionally send the same webhook twice.
  // The order_id UNIQUE constraint in Supabase will catch this,
  // but we check first to avoid unnecessary token generation.
  const existingCheck = await supabaseRequest(
    `/rest/v1/access_tokens?order_id=eq.${encodeURIComponent(orderId)}&select=token`,
    'GET'
  );

  if (existingCheck.ok) {
    const existing = await existingCheck.json();
    if (existing.length > 0) {
      console.log(`Duplicate webhook for order ${orderId} — skipping`);
      return { statusCode: 200, body: 'Already processed' };
    }
  }

  // ── 4. Generate a signed access token ────────────────────
  // Format: [random bytes].[HMAC signature]
  // The signature ties the random part to your TOKEN_SECRET,
  // so tokens can't be forged even if someone knows the format.
  const randomPart = crypto.randomBytes(32).toString('hex');
  const signature  = crypto
    .createHmac('sha256', process.env.TOKEN_SECRET)
    .update(randomPart)
    .digest('hex');
  const token = `${randomPart}.${signature}`;

  // Token never expires by default. To add expiry (e.g., 1 year):
  // const expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
  const expiresAt = null;

  // ── 5. Store token in Supabase ────────────────────────────
  const insertRes = await supabaseRequest('/rest/v1/access_tokens', 'POST', {
    token,
    email,
    order_id:   orderId,
    expires_at: expiresAt,
  });

  if (!insertRes.ok) {
    const err = await insertRes.text();
    console.error('Supabase insert failed:', err);
    return { statusCode: 500, body: 'Failed to store token' };
  }

  // ── 6. Send access email via Resend ──────────────────────
  const accessLink    = `${guideUrl}?token=${token}`;
  const isCompleteSuite = guideUrl.includes('complete-suite');
  const baseUrl       = new URL(guideUrl).origin;

  const emailBody = isCompleteSuite
    ? buildCompleteSuiteEmail(firstName, token, baseUrl)
    : buildSingleGuideEmail(firstName, accessLink);

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from:    process.env.FROM_EMAIL,
      to:      email,
      subject: isCompleteSuite
        ? 'Your complete suite — all access links inside'
        : 'Your course guide — access link inside',
      html: emailBody,
    }),
  });

  if (!emailRes.ok) {
    // Token is already saved — log the error but don't fail the webhook.
    // The buyer can contact you for their link. Don't return 500 or LS will retry.
    console.error('Resend email failed:', await emailRes.text());
  } else {
    console.log(`Access email sent to ${email} for order ${orderId}`);
  }

  return { statusCode: 200, body: 'OK' };
};

// ── Email builders ────────────────────────────────────────────
function buildSingleGuideEmail(firstName, accessLink) {
  return `<!DOCTYPE html>
<html>
<body style="font-family: Georgia, serif; background: #faf8f5; margin: 0; padding: 40px 20px;">
  <div style="max-width: 560px; margin: 0 auto; background: white; border: 1px solid #e0dbd3; border-radius: 8px; padding: 40px 36px;">
    <h2 style="font-size: 22px; color: #1c1917; margin-top: 0;">Hi ${firstName}, you're in.</h2>
    <p style="color: #3d3832; line-height: 1.75; font-size: 15px;">
      Thanks for your purchase. Your course guide is ready — click the link below to access it any time.
    </p>
    <div style="text-align: center; margin: 32px 0;">
      <a href="${accessLink}" style="background: #b8430a; color: white; text-decoration: none; padding: 14px 28px; border-radius: 5px; font-family: sans-serif; font-weight: 600; font-size: 15px; display: inline-block;">
        Open Your Course Guide →
      </a>
    </div>
    <p style="color: #6b6560; font-size: 13px; line-height: 1.7;">
      <strong>Save this email.</strong> This link is your personal access — bookmark it or save it somewhere handy. It doesn't expire.
    </p>
    <hr style="border: none; border-top: 1px solid #e0dbd3; margin: 28px 0;" />
    <p style="color: #9c9690; font-size: 12px; margin: 0;">
      Your access link: <a href="${accessLink}" style="color: #b8430a; word-break: break-all;">${accessLink}</a>
    </p>
  </div>
</body>
</html>`;
}

function buildCompleteSuiteEmail(firstName, token, baseUrl) {
  const guides = [
    { label: 'Core Guide — Build Your Business Website', path: '/guide' },
    { label: 'Add-on 01 — Calendar Sync Automation',    path: '/guide-2' },
    { label: 'Add-on 02 — Invoice & Payments',          path: '/guide-3' },
    { label: 'Add-on 03 — Staff Portal',                path: '/guide-4' },
    { label: 'Add-on 04 — Client Portal',               path: '/guide-5' },
  ];

  const linkRows = guides.map(g => `
    <tr>
      <td style="padding: 10px 0; border-bottom: 1px solid #f0ede8;">
        <a href="${baseUrl}${g.path}?token=${token}"
           style="color: #b8430a; font-size: 14px; text-decoration: none; font-family: sans-serif;">
          ${g.label} →
        </a>
      </td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html>
<body style="font-family: Georgia, serif; background: #faf8f5; margin: 0; padding: 40px 20px;">
  <div style="max-width: 560px; margin: 0 auto; background: white; border: 1px solid #e0dbd3; border-radius: 8px; padding: 40px 36px;">
    <h2 style="font-size: 22px; color: #1c1917; margin-top: 0;">Hi ${firstName}, you have full access.</h2>
    <p style="color: #3d3832; line-height: 1.75; font-size: 15px;">
      Thanks for purchasing the complete suite. Each guide has its own link below — bookmark them all or save this email.
    </p>
    <table style="width: 100%; border-collapse: collapse; margin: 24px 0;">
      ${linkRows}
    </table>
    <p style="color: #6b6560; font-size: 13px; line-height: 1.7;">
      <strong>These links are your personal access.</strong> They don't expire, but don't share them — each link is tied to your purchase.
    </p>
    <p style="color: #6b6560; font-size: 13px; line-height: 1.7;">
      If you have any issues, reply to this email and we'll sort it out.
    </p>
  </div>
</body>
</html>`;
}

// ── Supabase helper ───────────────────────────────────────────
// Wraps fetch with the required Supabase auth headers.
function supabaseRequest(path, method, body) {
  const url = `${process.env.SUPABASE_URL}${path}`;
  const options = {
    method,
    headers: {
      'apikey':        process.env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        method === 'POST' ? 'return=minimal' : undefined,
    },
  };
  if (body) options.body = JSON.stringify(body);
  return fetch(url, options);
}

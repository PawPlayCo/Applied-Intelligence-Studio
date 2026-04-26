// netlify/functions/ls-webhook.js
//
// Receives POST from Lemon Squeezy when an order is completed.
// 1. Validates the webhook signature
// 2. Checks for duplicate order (idempotency)
// 3. Detects which variant was purchased (core guide vs complete suite)
// 4. Generates a signed access token
// 5. Stores it in Supabase
// 6. Emails the buyer their access link via Resend
//
// Required Netlify environment variables:
//   LS_WEBHOOK_SECRET     — from Lemon Squeezy → Settings → Webhooks
//   SUPABASE_URL          — your Supabase project URL
//   SUPABASE_SERVICE_KEY  — your Supabase service_role key (NOT anon key)
//   RESEND_API_KEY        — from resend.com
//   FROM_EMAIL            — e.g. "Applied Intelligence Studio <hello@youremail.com>"
//   GUIDE_URL             — your Netlify URL e.g. "https://yoursite.netlify.app"
//   TOKEN_SECRET          — any long random string (used to sign tokens)

const crypto = require('crypto');

// Variant IDs — each maps to a specific guide file
const VARIANT_MAP = {
  '1005037':  'guide-gated.html',           // Core Guide only — $39.99
  '1576921':  'complete-suite-gated.html',  // Complete Suite (all 5) — $79.99
};

const DEFAULT_GUIDE = 'guide-gated.html';

const GUIDE_NAMES = {
  'guide-gated.html':          'Build Your Business Website — Core Guide',
  'complete-suite-gated.html': 'Complete Suite — All 5 Guides',
};

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  const rawBody = event.body;

  // 1. Verify Lemon Squeezy webhook signature
  const lsSignature = event.headers['x-signature'] || event.headers['X-Signature'];
  if (!lsSignature) {
    console.error('Missing X-Signature header');
    return { statusCode: 401, body: 'Unauthorized' };
  }

  const expectedSig = crypto
    .createHmac('sha256', process.env.LS_WEBHOOK_SECRET)
    .update(rawBody)
    .digest('hex');

  let sigValid = false;
  try {
    sigValid = crypto.timingSafeEqual(
      Buffer.from(lsSignature, 'hex'),
      Buffer.from(expectedSig, 'hex')
    );
  } catch {
    sigValid = false;
  }

  if (!sigValid) {
    console.error('Invalid webhook signature');
    return { statusCode: 401, body: 'Invalid signature' };
  }

  // 2. Parse the event
  let payload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return { statusCode: 400, body: 'Invalid JSON' };
  }

  const eventName = payload.meta?.event_name;
  if (eventName !== 'order_created') {
    console.log(`Ignoring event type: ${eventName}`);
    return { statusCode: 200, body: 'Ignored' };
  }

  const orderId    = String(payload.data?.id);
  const attributes = payload.data?.attributes || {};
  const email      = attributes.user_email;
  const firstName  = attributes.user_name?.split(' ')[0] || 'there';

  if (!email || !orderId) {
    console.error('Missing email or order ID:', JSON.stringify(payload));
    return { statusCode: 400, body: 'Missing required fields' };
  }

  // 3. Detect which variant was purchased
  let variantId = null;
  if (attributes.first_order_item?.variant_id) {
    variantId = String(attributes.first_order_item.variant_id);
  }
  if (!variantId && payload.meta?.custom_data?.variant_id) {
    variantId = String(payload.meta.custom_data.variant_id);
  }

  const guideFile = VARIANT_MAP[variantId] || DEFAULT_GUIDE;
  const guideName = GUIDE_NAMES[guideFile] || 'Your Course Guide';
  const isSuite   = guideFile === 'complete-suite-gated.html';

  console.log(`Order ${orderId} | variant=${variantId} | guide=${guideFile} | email=${email}`);

  // 4. Check for duplicate order
  const existingCheck = await supabaseRequest(
    `/rest/v1/access_tokens?order_id=eq.${encodeURIComponent(orderId)}&select=token`,
    'GET'
  );

  if (existingCheck.ok) {
    const existing = await existingCheck.json();
    if (existing.length > 0) {
      console.log(`Duplicate webhook for order ${orderId} - skipping`);
      return { statusCode: 200, body: 'Already processed' };
    }
  }

  // 5. Generate a signed access token
  const randomPart = crypto.randomBytes(32).toString('hex');
  const signature  = crypto
    .createHmac('sha256', process.env.TOKEN_SECRET)
    .update(randomPart)
    .digest('hex');
  const token = `${randomPart}.${signature}`;

  // 6. Store token in Supabase
  const insertRes = await supabaseRequest('/rest/v1/access_tokens', 'POST', {
    token,
    email,
    order_id:   orderId,
    expires_at: null,
  });

  if (!insertRes.ok) {
    const err = await insertRes.text();
    console.error('Supabase insert failed:', err);
    return { statusCode: 500, body: 'Failed to store token' };
  }

  // 7. Send access email via Resend
  const accessLink = `${process.env.GUIDE_URL}/${guideFile}?token=${token}`;

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from:    process.env.FROM_EMAIL,
      to:      email,
      subject: `Your access link - ${guideName}`,
      html: `
        <!DOCTYPE html>
        <html>
        <body style="font-family: Georgia, serif; background: #f7f7f5; margin: 0; padding: 40px 20px;">
          <div style="max-width: 560px; margin: 0 auto; background: white; border: 1px solid #d8d8d3; border-radius: 8px; padding: 40px 36px;">
            <div style="font-family: sans-serif; font-size: 11px; letter-spacing: 0.16em; text-transform: uppercase; color: #a1a1aa; margin-bottom: 20px;">Applied Intelligence Studio</div>
            <h2 style="font-size: 22px; color: #18181b; margin-top: 0; font-weight: 700;">Hi ${firstName}, you're in.</h2>
            <p style="color: #3f3f46; line-height: 1.75; font-size: 15px; margin-bottom: 16px;">
              ${isSuite
                ? 'Your Complete Suite purchase is confirmed. All five guides are ready - click below to access them any time.'
                : 'Your guide is ready. Click the link below to access it any time.'}
            </p>
            ${isSuite ? `
            <div style="background: #f7f7f5; border: 1px solid #d8d8d3; border-radius: 6px; padding: 16px 18px; margin-bottom: 24px; font-family: sans-serif; font-size: 13px; color: #71717a; line-height: 1.7;">
              Included: Core Guide, Calendar Sync, Invoice and Payments, Staff Portal and Admin Dashboard, Client Portal with Secure Login.
            </div>` : ''}
            <div style="text-align: center; margin: 28px 0;">
              <a href="${accessLink}"
                 style="background: #1c3828; color: #e8f0ec; text-decoration: none; padding: 14px 28px; border-radius: 4px; font-family: sans-serif; font-weight: 600; font-size: 15px; display: inline-block;">
                Open ${isSuite ? 'Your Complete Suite' : 'Your Guide'} →
              </a>
            </div>
            <p style="color: #71717a; font-size: 13px; line-height: 1.7;">
              <strong style="color: #3f3f46;">Save this email.</strong> This link is your personal access - bookmark it or save it somewhere handy. It does not expire.
            </p>
            <p style="color: #71717a; font-size: 13px; line-height: 1.7;">
              If you have any issues accessing your purchase, reply to this email and we will sort it out.
            </p>
            <hr style="border: none; border-top: 1px solid #d8d8d3; margin: 24px 0;" />
            <p style="color: #a1a1aa; font-size: 11px; margin: 0; word-break: break-all;">
              Your access link: <a href="${accessLink}" style="color: #1c3828;">${accessLink}</a>
            </p>
          </div>
        </body>
        </html>
      `,
    }),
  });

  if (!emailRes.ok) {
    console.error('Resend email failed:', await emailRes.text());
  } else {
    console.log(`Access email sent to ${email} | guide=${guideFile} | order=${orderId}`);
  }

  return { statusCode: 200, body: 'OK' };
};

// Supabase helper
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

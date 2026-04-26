// netlify/functions/resend-link.js
//
// Called when a buyer enters their email to resend their access link.
// Looks up by email, resends the link if found.
// Always returns 200 regardless of whether the email exists
// (prevents email enumeration attacks).
//
// Required environment variables: same as ls-webhook.js

exports.handler = async (event) => {
  const cors = {
    'Access-Control-Allow-Origin':  '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: cors, body: '' };
  }

  let email;
  try {
    ({ email } = JSON.parse(event.body));
  } catch {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ ok: false }) };
  }

  if (!email || !email.includes('@')) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ ok: false }) };
  }

  // Look up the most recent non-revoked token for this email
  const res = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/access_tokens?email=eq.${encodeURIComponent(email.toLowerCase())}&revoked=eq.false&order=created_at.desc&limit=1&select=token`,
    {
      headers: {
        'apikey':        process.env.SUPABASE_SERVICE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      },
    }
  );

  // Always return 200 — don't reveal whether the email exists
  if (!res.ok) {
    console.error('Supabase error on resend lookup:', res.status);
    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
  }

  const rows = await res.json();
  if (!rows.length) {
    // No token found — return 200 silently
    console.log(`Resend requested for ${email} — no token found`);
    return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
  }

  const { token } = rows[0];
  const accessLink = `${process.env.GUIDE_URL}?token=${token}`;
  const firstName  = email.split('@')[0]; // best we can do without the name

  // Send the email
  await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type':  'application/json',
    },
    body: JSON.stringify({
      from:    process.env.FROM_EMAIL,
      to:      email,
      subject: 'Your course guide access link',
      html: `
        <!DOCTYPE html>
        <html>
        <body style="font-family: Georgia, serif; background: #faf8f5; margin: 0; padding: 40px 20px;">
          <div style="max-width: 560px; margin: 0 auto; background: white; border: 1px solid #e0dbd3; border-radius: 8px; padding: 40px 36px;">
            <h2 style="font-size: 20px; color: #1c1917; margin-top: 0;">Here's your access link</h2>
            <p style="color: #3d3832; line-height: 1.75; font-size: 15px;">
              You requested a resend of your course guide access link. Click below to open it.
            </p>
            <div style="text-align: center; margin: 32px 0;">
              <a href="${accessLink}"
                 style="background: #b8430a; color: white; text-decoration: none; padding: 14px 28px; border-radius: 5px; font-family: sans-serif; font-weight: 600; font-size: 15px; display: inline-block;">
                Open Course Guide →
              </a>
            </div>
            <p style="color: #6b6560; font-size: 13px; line-height: 1.7;">
              <strong>Bookmark it.</strong> This is your permanent access link.
            </p>
            <hr style="border: none; border-top: 1px solid #e0dbd3; margin: 24px 0;" />
            <p style="color: #9c9690; font-size: 12px; margin: 0; word-break: break-all;">
              ${accessLink}
            </p>
          </div>
        </body>
        </html>
      `,
    }),
  }).catch(err => console.error('Resend email error:', err));

  return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) };
};

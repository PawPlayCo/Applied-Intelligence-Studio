# Paywall Setup — Complete Step-by-Step

Everything you need to get the paywall live. Do these steps in order.

---

## Files in this package

```
guide.html                          ← Your gated course guide (replaces course-guide.html)
supabase-setup.sql                  ← Run this once in Supabase SQL Editor
netlify/functions/ls-webhook.js     ← Receives Lemon Squeezy payments
netlify/functions/validate-token.js ← Validates tokens on every page load
netlify/functions/resend-link.js    ← Resends access links by email
```

---

## Step 1 — Supabase table

1. Open your Supabase project → SQL Editor → New query
2. Paste the contents of `supabase-setup.sql` and run it
3. Confirm by running: `select * from access_tokens;` (should return empty table, no error)

---

## Step 2 — Generate your TOKEN_SECRET

This is a random string used to sign and verify tokens. Generate one now and save it — you'll use it in two places.

**Mac / Linux terminal:**
```
openssl rand -hex 32
```

**Windows (PowerShell):**
```
[Convert]::ToBase64String((1..32 | ForEach-Object { Get-Random -Maximum 256 }))
```

Copy the output. You'll paste it into Netlify environment variables as `TOKEN_SECRET`.

---

## Step 3 — Lemon Squeezy setup

1. Create an account at lemon squeezy.com
2. Create a new product → type: "Digital product" → set your price
3. In the product checkout settings, set the confirmation / thank you page to your guide URL:
   `https://yourdomain.com/guide?thanks=1`
   (The actual access link comes by email — this page just says "check your email")

4. Go to Settings → Webhooks → Add webhook:
   - URL: `https://yourdomain.com/.netlify/functions/ls-webhook`
   - Events: check `order_created` only
   - Copy the **Signing secret** — this is your `LS_WEBHOOK_SECRET`

5. Copy your product's checkout URL — you'll paste it into `guide.html`

---

## Step 4 — Update guide.html

Open `guide.html` and find these two placeholders (search for YOUR_LEMON_SQUEEZY):

```html
<a href="YOUR_LEMON_SQUEEZY_CHECKOUT_URL" ...>
```

Replace `YOUR_LEMON_SQUEEZY_CHECKOUT_URL` (appears twice) with your actual Lemon Squeezy checkout link.

Also update the contact email near the bottom of the gate UI:
```html
<a href="mailto:hello@yourdomain.com">
```

---

## Step 5 — Set Netlify environment variables

Go to Netlify → your site → Site configuration → Environment variables → Add variables.

Add ALL of these:

| Variable name         | Value                                            |
|-----------------------|--------------------------------------------------|
| `LS_WEBHOOK_SECRET`   | The signing secret from Lemon Squeezy webhooks   |
| `TOKEN_SECRET`        | The random string you generated in Step 2        |
| `SUPABASE_URL`        | Your Supabase project URL (from Settings → API)  |
| `SUPABASE_SERVICE_KEY`| Your Supabase service_role key (NOT anon key)    |
| `RESEND_API_KEY`      | Your Resend API key                              |
| `FROM_EMAIL`          | e.g. `Your Business <hello@yourdomain.com>`      |
| `GUIDE_URL`           | e.g. `https://yourdomain.com/guide`              |
| `OWNER_EMAIL`         | Your email (for payment notification emails)     |

After adding all variables, trigger a new Netlify deploy.

---

## Step 6 — Add netlify.toml (if you don't have one)

Create a `netlify.toml` in your project root:

```toml
[functions]
  node_bundler = "nft"
```

This prevents a bundling error with the crypto module.

---

## Step 7 — Deploy your files

Copy these files into your project and push to GitHub:

```
guide.html                               → root of your project (or /guide/index.html)
netlify/functions/ls-webhook.js          → netlify/functions/
netlify/functions/validate-token.js      → netlify/functions/
netlify/functions/resend-link.js         → netlify/functions/
```

Netlify will auto-deploy.

---

## Step 8 — Test end to end

1. Open `yourdomain.com/guide` in an incognito window
   → Should show the purchase gate (not the guide content)

2. Make a test purchase on Lemon Squeezy (use their test mode)
   → Should receive an email with an access link within ~30 seconds

3. Click the access link
   → Should open the guide immediately, no gate

4. Open the link in a new incognito window
   → Should still work (token is valid)

5. Test the resend flow: open the gate, enter your email, check inbox

---

## Revoking access (e.g. for a refund)

In Supabase → Table Editor → access_tokens:
- Find the row by email or order_id
- Set `revoked = true`

That buyer's link immediately stops working. Their next page load will show the invalid screen.

---

## Troubleshooting

**Gate shows but purchase redirects to wrong page**
→ Update the `href` values in `guide.html` — search for `YOUR_LEMON_SQUEEZY_CHECKOUT_URL`

**Webhook fires but no email arrives**
→ Check Netlify Functions logs (Netlify → Functions → ls-webhook → logs)
→ Check Resend dashboard for failed sends
→ Confirm `FROM_EMAIL` domain is verified in Resend

**"Token not found" for a legitimate buyer**
→ Check Supabase → access_tokens table for their row
→ Check Netlify function logs for the webhook — did it arrive and process?
→ Check Lemon Squeezy → Webhooks → Recent deliveries for errors

**Validation function returns 500**
→ Check that `SUPABASE_URL` doesn't have a trailing slash
→ Confirm `SUPABASE_SERVICE_KEY` is the service_role key, not the anon key

**Functions work locally but fail on Netlify**
→ Make sure all environment variables are set AND a new deploy was triggered after setting them
→ Environment variable changes don't apply to already-running functions

---

## What this does NOT cover

- Subscription billing (this is one-time purchase only)
- Multiple products with different access tiers
- Team/gifted licenses
- Analytics on who accessed what and when (the `accessed_at` field captures last access, but no dashboard is built)

All of these are buildable extensions to this system.

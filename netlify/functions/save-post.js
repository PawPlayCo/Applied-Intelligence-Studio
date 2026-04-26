const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Secret',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };

  const secret = event.headers['x-admin-secret'];
  if (!secret || secret !== process.env.ADMIN_SECRET) {
    return { statusCode: 401, headers: cors, body: JSON.stringify({ ok: false, error: 'Unauthorized' }) };
  }

  // ── DELETE ────────────────────────────────────────────────────
  if (event.httpMethod === 'DELETE') {
    const slug = event.queryStringParameters?.slug;
    if (!slug) return { statusCode: 400, headers: cors, body: JSON.stringify({ ok: false }) };

    const res = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/blog_posts?slug=eq.${encodeURIComponent(slug)}`,
      {
        method: 'DELETE',
        headers: { 'apikey': process.env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`, 'Prefer': 'return=minimal' },
      }
    );

    return res.ok
      ? { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true }) }
      : { statusCode: 500, headers: cors, body: JSON.stringify({ ok: false }) };
  }

  // ── POST (save / update) ──────────────────────────────────────
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: JSON.stringify({ ok: false }) };

  let body;
  try { body = JSON.parse(event.body); } catch {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ ok: false }) };
  }

  const { slug, title, excerpt, content, published } = body;
  if (!slug || !title || !content) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ ok: false, error: 'Missing required fields: slug, title, content' }) };
  }

  // Check for existing post
  const checkRes = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/blog_posts?slug=eq.${encodeURIComponent(slug)}&select=slug,published_at`,
    { headers: { 'apikey': process.env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}` } }
  );
  const existing = await checkRes.json();
  const isNew    = !existing.length;
  const now      = new Date().toISOString();

  const record = {
    slug,
    title,
    excerpt: excerpt || '',
    content,
    published: !!published,
    updated_at: now,
  };

  if (isNew) record.created_at = now;
  if (published && (!existing[0] || !existing[0].published_at)) record.published_at = now;

  const url = isNew
    ? `${process.env.SUPABASE_URL}/rest/v1/blog_posts`
    : `${process.env.SUPABASE_URL}/rest/v1/blog_posts?slug=eq.${encodeURIComponent(slug)}`;

  const saveRes = await fetch(url, {
    method: isNew ? 'POST' : 'PATCH',
    headers: {
      'apikey':        process.env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=minimal',
    },
    body: JSON.stringify(record),
  });

  if (!saveRes.ok) {
    const err = await saveRes.text();
    console.error('Supabase save error:', err);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ ok: false, error: 'Save failed' }) };
  }

  return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, slug }) };
};

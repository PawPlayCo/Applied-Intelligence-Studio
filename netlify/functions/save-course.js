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
    const id = event.queryStringParameters?.id;
    if (!id) return { statusCode: 400, headers: cors, body: JSON.stringify({ ok: false }) };

    const res = await fetch(
      `${process.env.SUPABASE_URL}/rest/v1/courses?id=eq.${encodeURIComponent(id)}`,
      {
        method: 'DELETE',
        headers: {
          'apikey':        process.env.SUPABASE_SERVICE_KEY,
          'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
          'Prefer':        'return=minimal',
        },
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

  const { id, title, slug, excerpt, description, tag, price, checkout_url, course_path, featured, published, display_order } = body;
  if (!title || !slug) {
    return { statusCode: 400, headers: cors, body: JSON.stringify({ ok: false, error: 'title and slug are required' }) };
  }

  const now = new Date().toISOString();
  const record = {
    title,
    slug,
    excerpt:       excerpt       || '',
    description:   description   || '',
    tag:           tag           || '',
    price:         price         || '',
    checkout_url:  checkout_url  || '',
    course_path:   course_path   || '',
    featured:      !!featured,
    published:     !!published,
    display_order: Number(display_order) || 0,
    updated_at:    now,
  };

  let url, method;
  if (id) {
    url    = `${process.env.SUPABASE_URL}/rest/v1/courses?id=eq.${encodeURIComponent(id)}`;
    method = 'PATCH';
  } else {
    record.created_at = now;
    url    = `${process.env.SUPABASE_URL}/rest/v1/courses`;
    method = 'POST';
  }

  const saveRes = await fetch(url, {
    method,
    headers: {
      'apikey':        process.env.SUPABASE_SERVICE_KEY,
      'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type':  'application/json',
      'Prefer':        'return=representation',
    },
    body: JSON.stringify(record),
  });

  if (!saveRes.ok) {
    const err = await saveRes.text();
    console.error('Supabase save error:', err);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ ok: false, error: 'Save failed' }) };
  }

  const saved  = await saveRes.json();
  const savedId = Array.isArray(saved) ? saved[0]?.id : saved?.id;
  return { statusCode: 200, headers: cors, body: JSON.stringify({ ok: true, id: savedId || id, slug }) };
};

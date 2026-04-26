const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Secret',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'GET')    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };

  const slug = event.queryStringParameters?.slug;
  if (!slug) return { statusCode: 400, headers: cors, body: JSON.stringify({ error: 'Missing slug' }) };

  const isAdmin    = event.headers['x-admin-secret'] === process.env.ADMIN_SECRET && !!process.env.ADMIN_SECRET;
  const pubFilter  = isAdmin ? '' : '&published=eq.true';

  const res = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/blog_posts?slug=eq.${encodeURIComponent(slug)}${pubFilter}&select=slug,title,excerpt,content,published,published_at`,
    { headers: { 'apikey': process.env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}` } }
  );

  if (!res.ok) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Server error' }) };

  const rows = await res.json();
  if (!rows.length) return { statusCode: 404, headers: cors, body: JSON.stringify({ error: 'Post not found' }) };

  return { statusCode: 200, headers: cors, body: JSON.stringify(rows[0]) };
};

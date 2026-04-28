const cors = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'Content-Type, X-Admin-Secret',
  'Content-Type': 'application/json',
};

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers: cors, body: '' };
  if (event.httpMethod !== 'GET')    return { statusCode: 405, headers: cors, body: JSON.stringify({ error: 'Method not allowed' }) };

  const isAdmin = event.headers['x-admin-secret'] === process.env.ADMIN_SECRET && !!process.env.ADMIN_SECRET;
  const filter  = isAdmin ? '' : '&published=eq.true';
  const fields  = 'id,title,slug,excerpt,description,tag,price,checkout_url,course_path,featured,published,display_order,created_at,updated_at';

  const res = await fetch(
    `${process.env.SUPABASE_URL}/rest/v1/courses?order=display_order.asc,created_at.desc${filter}&select=${fields}`,
    { headers: { 'apikey': process.env.SUPABASE_SERVICE_KEY, 'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_KEY}` } }
  );

  if (!res.ok) return { statusCode: 500, headers: cors, body: JSON.stringify({ error: 'Failed to fetch courses' }) };

  const courses = await res.json();
  return { statusCode: 200, headers: cors, body: JSON.stringify(courses) };
};

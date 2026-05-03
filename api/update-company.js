function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(payload));
}

async function supabaseServiceFetch(path, options = {}) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  const response = await fetch(`${supabaseUrl}${path}`, {
    ...options,
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
      prefer: "return=representation",
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.message || data?.error || "Supabase request failed.");
  }
  return data;
}

async function getUserFromToken(token) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: anonKey,
      authorization: `Bearer ${token}`
    }
  });
  const user = await response.json().catch(() => null);
  if (!response.ok || !user?.id) {
    throw new Error("Invalid Supabase session.");
  }
  return user;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  }

  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!token) {
      return sendJson(res, 401, { ok: false, error: "Missing Supabase access token." });
    }

    const user = await getUserFromToken(token);
    const profiles = await supabaseServiceFetch(`/rest/v1/profiles?id=eq.${user.id}&select=company_id`);
    const companyId = profiles[0]?.company_id;
    if (!companyId) {
      return sendJson(res, 404, { ok: false, error: "Profile not found." });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const companies = await supabaseServiceFetch(`/rest/v1/companies?id=eq.${companyId}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: body.name,
        abn: body.abn
      })
    });

    return sendJson(res, 200, { ok: true, company: companies[0] });
  } catch (error) {
    return sendJson(res, 500, { ok: false, error: error.message });
  }
};

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(payload));
}

function cleanCompanyName(email) {
  const prefix = String(email || "TerrainDesk Customer").split("@")[0];
  return `${prefix.replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())} Landscaping`;
}

async function supabaseFetch(path, options = {}) {
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
    throw new Error(data?.message || data?.error_description || data?.error || "Supabase request failed.");
  }
  return data;
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

    const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !anonKey) {
      return sendJson(res, 500, { ok: false, error: "Missing SUPABASE_URL or SUPABASE_ANON_KEY." });
    }

    const userResponse = await fetch(`${supabaseUrl}/auth/v1/user`, {
      headers: {
        apikey: anonKey,
        authorization: `Bearer ${token}`
      }
    });
    const user = await userResponse.json().catch(() => null);
    if (!userResponse.ok || !user?.id) {
      return sendJson(res, 401, { ok: false, error: "Invalid Supabase session." });
    }

    const existingProfiles = await supabaseFetch(`/rest/v1/profiles?id=eq.${user.id}&select=id,company_id,email`);
    if (existingProfiles.length) {
      return sendJson(res, 200, {
        ok: true,
        profile: existingProfiles[0],
        created: false
      });
    }

    const companies = await supabaseFetch("/rest/v1/companies", {
      method: "POST",
      body: JSON.stringify({
        name: cleanCompanyName(user.email),
        plan: "Operations",
        subscription_status: "active"
      })
    });
    const company = companies[0];

    const profiles = await supabaseFetch("/rest/v1/profiles", {
      method: "POST",
      body: JSON.stringify({
        id: user.id,
        company_id: company.id,
        email: user.email,
        role: "owner"
      })
    });

    await supabaseFetch("/rest/v1/automation_settings", {
      method: "POST",
      body: JSON.stringify({
        company_id: company.id,
        settings: {
          quoteFollowUp: true,
          crewReminder: true,
          photoRequest: true,
          reviewRequest: true,
          invoiceReminder: true,
          marginAlert: true
        }
      })
    });

    return sendJson(res, 200, {
      ok: true,
      profile: profiles[0],
      company,
      created: true
    });
  } catch (error) {
    return sendJson(res, 500, { ok: false, error: error.message });
  }
};

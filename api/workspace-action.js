const { readJson, sendJson, supabaseFetch } = require("./_shared");

async function getAuthedProfile(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Missing auth token.");

  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${token}`
    }
  });
  const user = await response.json().catch(() => null);
  if (!response.ok || !user?.id) throw new Error("Invalid auth token.");

  const profiles = await supabaseFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=*`);
  if (!profiles.length) throw new Error("Profile not found.");
  return profiles[0];
}

function positiveNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

async function createLead(profile, body) {
  if (!body.name || !body.email) throw new Error("Client name and email are required.");
  const rows = await supabaseFetch("/rest/v1/leads", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({
      company_id: profile.company_id,
      name: body.name,
      email: body.email,
      suburb: body.suburb || "",
      service: body.service || "Garden maintenance",
      urgency: body.urgency || "Flexible",
      status: "New"
    })
  });
  return { lead: rows[0] };
}

async function createQuote(profile, body) {
  if (!body.leadId) throw new Error("Choose a lead first.");
  const leads = await supabaseFetch(`/rest/v1/leads?id=eq.${encodeURIComponent(body.leadId)}&company_id=eq.${encodeURIComponent(profile.company_id)}&select=id`);
  if (!leads.length) throw new Error("Lead not found.");

  const hours = positiveNumber(body.hours, 1);
  const rate = positiveNumber(body.rate, 85);
  const materials = positiveNumber(body.materials, 0);
  const markup = positiveNumber(body.markup, 25);
  const amount = Math.round((hours * rate + materials) * (1 + markup / 100) * 1.1);

  const rows = await supabaseFetch("/rest/v1/quotes", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({
      company_id: profile.company_id,
      lead_id: body.leadId,
      service: body.service || "Garden maintenance",
      amount,
      status: "Sent"
    })
  });

  await supabaseFetch(`/rest/v1/leads?id=eq.${encodeURIComponent(body.leadId)}&company_id=eq.${encodeURIComponent(profile.company_id)}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "Quoted" })
  });

  return { quote: rows[0], amount };
}

async function updateLead(profile, body) {
  if (!body.leadId) throw new Error("leadId is required.");
  const rows = await supabaseFetch(`/rest/v1/leads?id=eq.${encodeURIComponent(body.leadId)}&company_id=eq.${encodeURIComponent(profile.company_id)}`, {
    method: "PATCH",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({ status: body.status || "Contacted" })
  });
  return { lead: rows[0] };
}

async function deleteLead(profile, body) {
  if (!body.leadId) throw new Error("leadId is required.");
  const company = encodeURIComponent(profile.company_id);
  const lead = encodeURIComponent(body.leadId);
  await supabaseFetch(`/rest/v1/invoices?lead_id=eq.${lead}&company_id=eq.${company}`, { method: "DELETE" });
  await supabaseFetch(`/rest/v1/jobs?lead_id=eq.${lead}&company_id=eq.${company}`, { method: "DELETE" });
  await supabaseFetch(`/rest/v1/quotes?lead_id=eq.${lead}&company_id=eq.${company}`, { method: "DELETE" });
  await supabaseFetch(`/rest/v1/leads?id=eq.${lead}&company_id=eq.${company}`, { method: "DELETE" });
  return { ok: true };
}

async function deleteQuote(profile, body) {
  if (!body.quoteId) throw new Error("quoteId is required.");
  const company = encodeURIComponent(profile.company_id);
  const quote = encodeURIComponent(body.quoteId);
  await supabaseFetch(`/rest/v1/jobs?quote_id=eq.${quote}&company_id=eq.${company}`, { method: "DELETE" });
  await supabaseFetch(`/rest/v1/quotes?id=eq.${quote}&company_id=eq.${company}`, { method: "DELETE" });
  return { ok: true };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed." });

  try {
    const profile = await getAuthedProfile(req);
    const body = await readJson(req);
    const actions = { createLead, createQuote, updateLead, deleteLead, deleteQuote };
    const action = actions[body.action];
    if (!action) return sendJson(res, 422, { ok: false, error: "Unknown workspace action." });
    const result = await action(profile, body);
    return sendJson(res, 200, { ok: true, ...result });
  } catch (error) {
    return sendJson(res, error.status || 500, { ok: false, error: error.message || "Workspace action failed." });
  }
};

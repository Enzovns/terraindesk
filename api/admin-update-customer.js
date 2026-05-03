const { readJson, requireAdmin, sendJson, supabaseFetch } = require("./_shared");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  }

  try {
    requireAdmin(req);
    const body = await readJson(req);
    if (!body.companyId) {
      return sendJson(res, 422, { ok: false, error: "companyId is required." });
    }

    const payload = {};
    for (const key of ["name", "abn", "plan", "subscription_status", "stripe_customer_id"]) {
      if (body[key] !== undefined) payload[key] = body[key];
    }

    const companies = await supabaseFetch(`/rest/v1/companies?id=eq.${body.companyId}`, {
      method: "PATCH",
      body: JSON.stringify(payload)
    });

    return sendJson(res, 200, { ok: true, company: companies[0] });
  } catch (error) {
    return sendJson(res, error.status || 500, { ok: false, error: error.message });
  }
};

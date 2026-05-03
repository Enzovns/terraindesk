const { readJson, sendJson, supabaseFetch } = require("./_shared");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed." });

  try {
    const body = await readJson(req);
    if (!body.companyId || !body.name || !body.email) {
      return sendJson(res, 422, { ok: false, error: "Company, name and email are required." });
    }

    const companies = await supabaseFetch(`/rest/v1/companies?id=eq.${encodeURIComponent(body.companyId)}&select=id,name`);
    if (!companies.length) return sendJson(res, 404, { ok: false, error: "Company not found." });

    const rows = await supabaseFetch("/rest/v1/leads", {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify({
        company_id: body.companyId,
        name: body.name,
        email: body.email,
        suburb: body.suburb || "",
        service: body.service || "Lawn mowing",
        urgency: body.urgency || "Flexible",
        status: "New"
      })
    });

    return sendJson(res, 200, { ok: true, company: companies[0], lead: rows[0] });
  } catch (error) {
    return sendJson(res, 500, { ok: false, error: error.message || "Could not create request." });
  }
};

const { requireAdmin, sendJson, supabaseFetch } = require("./_shared");

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
    return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  }

  try {
    requireAdmin(req);
    const [companies, profiles, leads, quotes, jobs, invoices] = await Promise.all([
      supabaseFetch("/rest/v1/companies?select=*&order=created_at.desc"),
      supabaseFetch("/rest/v1/profiles?select=*"),
      supabaseFetch("/rest/v1/leads?select=id,company_id,status"),
      supabaseFetch("/rest/v1/quotes?select=id,company_id,status,amount"),
      supabaseFetch("/rest/v1/jobs?select=id,company_id,status"),
      supabaseFetch("/rest/v1/invoices?select=id,company_id,status,amount")
    ]);

    return sendJson(res, 200, {
      ok: true,
      companies,
      profiles,
      leads,
      quotes,
      jobs,
      invoices
    });
  } catch (error) {
    return sendJson(res, error.status || 500, { ok: false, error: error.message });
  }
};

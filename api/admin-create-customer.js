const {
  escapeHtml,
  generateWorkspaceLink,
  getOrigin,
  readJson,
  requireAdmin,
  sendJson,
  sendResendEmail,
  supabaseFetch
} = require("./_shared");

const statusMap = {
  Active: "active",
  Onboarding: "onboarding",
  "At risk": "past_due"
};

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { error: "Method not allowed." });

  try {
    requireAdmin(req);
    const { company, email, plan, status } = await readJson(req);
    if (!company || !email || !plan) return sendJson(res, 400, { error: "Company, email and plan are required." });

    const origin = getOrigin(req);
    const created = await supabaseFetch("/rest/v1/companies", {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify({
        name: company,
        plan,
        subscription_status: statusMap[status] || "onboarding"
      })
    });

    const companyRow = Array.isArray(created) ? created[0] : created;
    if (!companyRow?.id) return sendJson(res, 500, { error: "Company was not created." });

    const linkPayload = await generateWorkspaceLink(email, origin, "invite");
    const actionLink = linkPayload?.properties?.action_link || linkPayload?.action_link;
    const userId = linkPayload?.user?.id || linkPayload?.properties?.user_id;

    if (userId) {
      await supabaseFetch("/rest/v1/profiles", {
        method: "POST",
        headers: { prefer: "resolution=merge-duplicates" },
        body: JSON.stringify({
          id: userId,
          company_id: companyRow.id,
          email,
          role: "owner"
        })
      });
    }

    await supabaseFetch("/rest/v1/automation_settings", {
      method: "POST",
      headers: { prefer: "resolution=merge-duplicates" },
      body: JSON.stringify({
        company_id: companyRow.id,
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

    if (actionLink) {
      await sendResendEmail({
        to: email,
        subject: "Your TerrainDesk workspace is ready",
        html: `
          <h2>Welcome to TerrainDesk</h2>
          <p>Your ${escapeHtml(plan)} workspace for ${escapeHtml(company)} is ready.</p>
          <p><a href="${escapeHtml(actionLink)}">Open your workspace</a></p>
        `
      });
    }

    return sendJson(res, 200, { ok: true, company: companyRow, actionLink });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || "Could not create customer." });
  }
};

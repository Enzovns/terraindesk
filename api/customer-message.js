const {
  escapeHtml,
  readJson,
  sendJson,
  sendResendEmail,
  supabaseFetch
} = require("./_shared");

function money(value) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

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

async function getLead(profile, leadId) {
  const leads = await supabaseFetch(`/rest/v1/leads?id=eq.${encodeURIComponent(leadId)}&company_id=eq.${encodeURIComponent(profile.company_id)}&select=*`);
  if (!leads.length) throw new Error("Lead not found.");
  return leads[0];
}

async function getCompany(companyId) {
  const companies = await supabaseFetch(`/rest/v1/companies?id=eq.${encodeURIComponent(companyId)}&select=*`);
  return companies[0] || {};
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed." });

  try {
    const profile = await getAuthedProfile(req);
    const company = await getCompany(profile.company_id);
    const body = await readJson(req);
    const lead = await getLead(profile, body.leadId);
    if (!lead.email) return sendJson(res, 422, { ok: false, error: "This client does not have an email address." });

    let subject;
    let html;
    let text;

    if (body.type === "quote") {
      subject = `${company.name || "TerrainDesk"} quote - ${body.service}`;
      html = `
        <div style="font-family:Arial,sans-serif;color:#17201b;line-height:1.55">
          <h1>Your landscaping quote</h1>
          <p>Hi ${escapeHtml(lead.name)},</p>
          <p>Here is your quote for <strong>${escapeHtml(body.service)}</strong>.</p>
          <p style="font-size:24px"><strong>${escapeHtml(money(body.amount))}</strong> inc. GST</p>
          <p>Reply to this email to approve the quote or ask a question.</p>
          <p>${escapeHtml(company.name || "")}</p>
        </div>
      `;
      text = `Quote for ${lead.name}: ${body.service} - ${money(body.amount)} inc. GST. Reply to approve.`;
    } else if (body.type === "invoice") {
      subject = `${company.name || "TerrainDesk"} invoice - ${money(body.amount)}`;
      html = `
        <div style="font-family:Arial,sans-serif;color:#17201b;line-height:1.55">
          <h1>Your invoice</h1>
          <p>Hi ${escapeHtml(lead.name)},</p>
          <p>Your invoice is ready.</p>
          <p style="font-size:24px"><strong>${escapeHtml(money(body.amount))}</strong></p>
          <p>Due date: ${escapeHtml(body.due || "Due soon")}</p>
          <p>Please reply if anything needs changing.</p>
        </div>
      `;
      text = `Invoice for ${lead.name}: ${money(body.amount)} due ${body.due || "soon"}.`;
    } else if (body.type === "reminder") {
      subject = `Reminder from ${company.name || "TerrainDesk"}`;
      html = `
        <div style="font-family:Arial,sans-serif;color:#17201b;line-height:1.55">
          <h1>Quick reminder</h1>
          <p>Hi ${escapeHtml(lead.name)},</p>
          <p>This is a friendly reminder about your outstanding invoice for <strong>${escapeHtml(money(body.amount))}</strong>.</p>
          <p>Reply here if you need anything from us.</p>
        </div>
      `;
      text = `Reminder for ${lead.name}: outstanding invoice ${money(body.amount)}.`;
    } else {
      return sendJson(res, 422, { ok: false, error: "Unknown message type." });
    }

    const result = await sendResendEmail({
      to: lead.email,
      replyTo: profile.email,
      subject,
      html,
      text
    });

    return sendJson(res, 200, { ok: true, id: result.id });
  } catch (error) {
    return sendJson(res, error.status || 500, { ok: false, error: error.message });
  }
};

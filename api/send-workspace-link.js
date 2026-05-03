const {
  escapeHtml,
  generateWorkspaceLink,
  getOrigin,
  readJson,
  requireAdmin,
  sendJson,
  sendResendEmail
} = require("./_shared");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  }

  try {
    requireAdmin(req);
    const body = await readJson(req);
    if (!body.email) {
      return sendJson(res, 422, { ok: false, error: "email is required." });
    }

    const origin = getOrigin(req);
    const link = await generateWorkspaceLink(body.email, origin, "magiclink");
    const actionLink = link.action_link || link.properties?.action_link;

    if (!actionLink) {
      return sendJson(res, 500, { ok: false, error: "Supabase did not return an action link." });
    }

    await sendResendEmail({
      to: body.email,
      subject: "Open your TerrainDesk workspace",
      html: `
        <div style="font-family:Arial,sans-serif;color:#17201b;line-height:1.55">
          <h1>Open your TerrainDesk workspace</h1>
          <p>Your workspace access link is ready.</p>
          <p><a href="${escapeHtml(actionLink)}">Open TerrainDesk</a></p>
        </div>
      `,
      text: `Open your TerrainDesk workspace: ${actionLink}`
    });

    return sendJson(res, 200, { ok: true, actionLink });
  } catch (error) {
    return sendJson(res, error.status || 500, { ok: false, error: error.message, details: error.data });
  }
};

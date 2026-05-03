function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(payload));
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function isEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || ""));
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  if (!isEmail(body.email)) {
    return sendJson(res, 422, { ok: false, error: "A valid work email is required." });
  }

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  const to = process.env.DEMO_TO_EMAIL;

  if (!apiKey || !from || !to) {
    return sendJson(res, 500, {
      ok: false,
      error: "Missing RESEND_API_KEY, RESEND_FROM_EMAIL or DEMO_TO_EMAIL in Vercel environment variables."
    });
  }

  const html = `
    <div style="font-family:Arial,sans-serif;color:#17201b;line-height:1.55">
      <h1 style="margin:0 0 12px">New TerrainDesk demo request</h1>
      <table cellpadding="8" cellspacing="0" style="border-collapse:collapse;border:1px solid #d9d4ca">
        <tr><td><strong>Work email</strong></td><td>${escapeHtml(body.email)}</td></tr>
        <tr><td><strong>Company size</strong></td><td>${escapeHtml(body.size)}</td></tr>
        <tr><td><strong>Plan</strong></td><td>${escapeHtml(body.plan)}</td></tr>
        <tr><td><strong>Estimated savings</strong></td><td>${escapeHtml(body.monthlySavings)}</td></tr>
        <tr><td><strong>Jobs / month</strong></td><td>${escapeHtml(body.jobs)}</td></tr>
        <tr><td><strong>Admin hours / job</strong></td><td>${escapeHtml(body.hours)}</td></tr>
        <tr><td><strong>Admin hourly cost</strong></td><td>${escapeHtml(body.rate)}</td></tr>
      </table>
    </div>
  `;

  const resendResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: [to],
      reply_to: body.email,
      subject: `TerrainDesk demo request - ${body.plan || "Operations"}`,
      html,
      text: `Demo request from ${body.email} for ${body.plan || "Operations"}`
    })
  });

  const result = await resendResponse.json().catch(() => ({}));
  if (!resendResponse.ok) {
    return sendJson(res, resendResponse.status, {
      ok: false,
      error: result.message || result.error || "Resend rejected the email.",
      details: result
    });
  }

  return sendJson(res, 200, { ok: true, id: result.id });
};

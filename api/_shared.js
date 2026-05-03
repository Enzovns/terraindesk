const crypto = require("node:crypto");

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

function getOrigin(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

async function readRawBody(req) {
  if (typeof req.body === "string") return req.body;
  if (req.body && typeof req.body === "object") return JSON.stringify(req.body);

  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 2_000_000) {
        reject(new Error("Request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
}

async function readJson(req) {
  const raw = await readRawBody(req);
  return raw ? JSON.parse(raw) : {};
}

function requireAdmin(req) {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) throw new Error("Missing ADMIN_API_KEY.");
  const provided = req.headers["x-admin-key"];
  if (provided !== expected) {
    const error = new Error("Unauthorized admin request.");
    error.status = 401;
    throw error;
  }
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

async function supabaseAuthAdmin(path, options = {}) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  }

  const response = await fetch(`${supabaseUrl}/auth/v1${path}`, {
    ...options,
    headers: {
      apikey: serviceKey,
      authorization: `Bearer ${serviceKey}`,
      "content-type": "application/json",
      ...(options.headers || {})
    }
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(data?.msg || data?.message || data?.error_description || data?.error || "Supabase Auth admin request failed.");
    error.status = response.status;
    error.data = data;
    throw error;
  }
  return data;
}

async function generateWorkspaceLink(email, origin, type = "invite") {
  try {
    return await supabaseAuthAdmin("/admin/generate_link", {
      method: "POST",
      body: JSON.stringify({
        type,
        email,
        redirect_to: `${origin}/app.html`
      })
    });
  } catch (error) {
    if (type === "invite") {
      return supabaseAuthAdmin("/admin/generate_link", {
        method: "POST",
        body: JSON.stringify({
          type: "magiclink",
          email,
          redirect_to: `${origin}/app.html`
        })
      });
    }
    throw error;
  }
}

async function sendResendEmail({ to, replyTo, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) {
    throw new Error("Missing RESEND_API_KEY or RESEND_FROM_EMAIL.");
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      from,
      to: Array.isArray(to) ? to : [to],
      reply_to: replyTo,
      subject,
      html,
      text
    })
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.message || data?.error || "Resend rejected the email.");
  }
  return data;
}

function verifyStripeSignature(rawBody, signatureHeader) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !signatureHeader) return false;

  const parts = Object.fromEntries(signatureHeader.split(",").map((part) => part.split("=")));
  const timestamp = parts.t;
  const expected = parts.v1;
  if (!timestamp || !expected) return false;

  const digest = crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(expected));
}

module.exports = {
  escapeHtml,
  generateWorkspaceLink,
  getOrigin,
  readJson,
  readRawBody,
  requireAdmin,
  sendJson,
  sendResendEmail,
  supabaseAuthAdmin,
  supabaseFetch,
  verifyStripeSignature
};

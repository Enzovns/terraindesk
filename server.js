const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const PORT = Number(process.env.PORT || 8787);
const ROOT = __dirname;

function loadEnvFile() {
  const envPath = path.join(ROOT, ".env");
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) continue;
    const index = trimmed.indexOf("=");
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

loadEnvFile();

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webp": "image/webp",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml"
};

const plans = {
  Essential: {
    label: "Essential",
    priceEnv: "STRIPE_PRICE_ESSENTIAL_AUD",
    fallbackAmount: "A$149 / month"
  },
  Operations: {
    label: "Operations",
    priceEnv: "STRIPE_PRICE_OPERATIONS_AUD",
    fallbackAmount: "A$329 / month"
  },
  "Multi-crew": {
    label: "Multi-crew",
    priceEnv: "STRIPE_PRICE_MULTI_CREW_AUD",
    fallbackAmount: "Custom"
  }
};

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolve(body));
    req.on("error", reject);
  });
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

async function sendResendEmail({ to, replyTo, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;

  if (!apiKey || !from) {
    const missing = [];
    if (!apiKey) missing.push("RESEND_API_KEY");
    if (!from) missing.push("RESEND_FROM_EMAIL");
    return { ok: false, status: 500, error: `Missing ${missing.join(" and ")}` };
  }

  const payload = {
    from,
    to: Array.isArray(to) ? to : [to],
    subject,
    html,
    text
  };

  if (replyTo) {
    payload.reply_to = replyTo;
  }

  const resendResponse = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const data = await resendResponse.json().catch(() => ({}));
  if (!resendResponse.ok) {
    return {
      ok: false,
      status: resendResponse.status,
      error: data.message || data.error || "Resend rejected the email",
      data
    };
  }

  return { ok: true, data };
}

function demoEmailHtml(payload) {
  return `
    <div style="font-family:Arial,sans-serif;color:#17201b;line-height:1.55">
      <h1 style="margin:0 0 12px">New TerrainDesk demo request</h1>
      <p>A landscaping company requested a sales demo from the website.</p>
      <table cellpadding="8" cellspacing="0" style="border-collapse:collapse;border:1px solid #d9d4ca">
        <tr><td><strong>Work email</strong></td><td>${escapeHtml(payload.email)}</td></tr>
        <tr><td><strong>Company size</strong></td><td>${escapeHtml(payload.size)}</td></tr>
        <tr><td><strong>Plan</strong></td><td>${escapeHtml(payload.plan)}</td></tr>
        <tr><td><strong>Estimated savings</strong></td><td>${escapeHtml(payload.monthlySavings)}</td></tr>
        <tr><td><strong>Jobs / month</strong></td><td>${escapeHtml(payload.jobs)}</td></tr>
        <tr><td><strong>Admin hours / job</strong></td><td>${escapeHtml(payload.hours)}</td></tr>
        <tr><td><strong>Admin hourly cost</strong></td><td>${escapeHtml(payload.rate)}</td></tr>
      </table>
    </div>
  `;
}

function onboardingEmailHtml(payload) {
  return `
    <div style="font-family:Arial,sans-serif;color:#17201b;line-height:1.55">
      <h1 style="margin:0 0 12px">Paid client onboarding submitted</h1>
      <p>A newly paid customer completed the onboarding form.</p>
      <table cellpadding="8" cellspacing="0" style="border-collapse:collapse;border:1px solid #d9d4ca">
        <tr><td><strong>Company</strong></td><td>${escapeHtml(payload.company)}</td></tr>
        <tr><td><strong>Contact email</strong></td><td>${escapeHtml(payload.email)}</td></tr>
        <tr><td><strong>Phone</strong></td><td>${escapeHtml(payload.phone)}</td></tr>
        <tr><td><strong>Main service</strong></td><td>${escapeHtml(payload.service)}</td></tr>
        <tr><td><strong>First goal</strong></td><td>${escapeHtml(payload.goal)}</td></tr>
        <tr><td><strong>Current tools</strong></td><td>${escapeHtml(payload.tools)}</td></tr>
      </table>
    </div>
  `;
}

async function handleDemoRequest(req, res) {
  const body = JSON.parse(await readBody(req) || "{}");
  if (!isEmail(body.email)) {
    return sendJson(res, 422, { ok: false, error: "A valid work email is required." });
  }

  const recipient = process.env.DEMO_TO_EMAIL || process.env.RESEND_TO_EMAIL;
  if (!recipient) {
    return sendJson(res, 500, { ok: false, error: "Missing DEMO_TO_EMAIL." });
  }

  const result = await sendResendEmail({
    to: recipient,
    replyTo: body.email,
    subject: `TerrainDesk demo request - ${body.plan || "Operations"}`,
    html: demoEmailHtml(body),
    text: `Demo request from ${body.email} for ${body.plan || "Operations"}`
  });

  if (!result.ok) {
    return sendJson(res, result.status || 500, { ok: false, error: result.error, details: result.data });
  }

  sendJson(res, 200, { ok: true, id: result.data.id });
}

async function handleClientIntake(req, res) {
  const body = JSON.parse(await readBody(req) || "{}");
  if (!isEmail(body.email) || !body.company) {
    return sendJson(res, 422, { ok: false, error: "Company and valid contact email are required." });
  }

  const recipient = process.env.ONBOARDING_TO_EMAIL || process.env.DEMO_TO_EMAIL || process.env.RESEND_TO_EMAIL;
  if (!recipient) {
    return sendJson(res, 500, { ok: false, error: "Missing ONBOARDING_TO_EMAIL or DEMO_TO_EMAIL." });
  }

  const result = await sendResendEmail({
    to: recipient,
    replyTo: body.email,
    subject: `TerrainDesk paid onboarding - ${body.company}`,
    html: onboardingEmailHtml(body),
    text: `Paid onboarding submitted by ${body.company} (${body.email})`
  });

  if (!result.ok) {
    return sendJson(res, result.status || 500, { ok: false, error: result.error, details: result.data });
  }

  sendJson(res, 200, { ok: true, id: result.data.id });
}

async function handleCheckout(req, res) {
  const body = JSON.parse(await readBody(req) || "{}");
  const plan = plans[body.plan] || plans.Operations;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env[plan.priceEnv];

  if (!stripeKey) {
    return sendJson(res, 500, { ok: false, error: "Missing STRIPE_SECRET_KEY." });
  }
  if (!priceId) {
    return sendJson(res, 500, { ok: false, error: `Missing ${plan.priceEnv}.` });
  }

  const origin = `${req.headers["x-forwarded-proto"] || "http"}://${req.headers.host}`;
  const params = new URLSearchParams();
  params.set("mode", "subscription");
  params.set("line_items[0][price]", priceId);
  params.set("line_items[0][quantity]", "1");
  params.set("success_url", `${origin}/client.html?session_id={CHECKOUT_SESSION_ID}&plan=${encodeURIComponent(plan.label)}`);
  params.set("cancel_url", `${origin}/#prix`);
  params.set("allow_promotion_codes", "true");
  params.set("billing_address_collection", "auto");
  params.set("client_reference_id", plan.label);
  params.set("metadata[plan]", plan.label);
  if (isEmail(body.email)) {
    params.set("customer_email", body.email);
  }

  const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${stripeKey}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: params
  });

  const data = await stripeResponse.json().catch(() => ({}));
  if (!stripeResponse.ok) {
    return sendJson(res, stripeResponse.status, { ok: false, error: data.error?.message || "Stripe rejected the checkout session.", details: data });
  }

  sendJson(res, 200, { ok: true, url: data.url, id: data.id });
}

function verifyStripeSignature(rawBody, signatureHeader) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !signatureHeader) return false;

  const parts = Object.fromEntries(signatureHeader.split(",").map((part) => part.split("=")));
  const timestamp = parts.t;
  const expected = parts.v1;
  if (!timestamp || !expected) return false;

  const signedPayload = `${timestamp}.${rawBody}`;
  const digest = crypto.createHmac("sha256", secret).update(signedPayload).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(expected));
}

async function handleStripeWebhook(req, res) {
  const rawBody = await readBody(req);
  if (!verifyStripeSignature(rawBody, req.headers["stripe-signature"])) {
    return sendJson(res, 400, { ok: false, error: "Invalid Stripe signature." });
  }

  const event = JSON.parse(rawBody);
  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const recipient = process.env.ONBOARDING_TO_EMAIL || process.env.DEMO_TO_EMAIL || process.env.RESEND_TO_EMAIL;
    if (recipient) {
      await sendResendEmail({
        to: recipient,
        replyTo: session.customer_details?.email,
        subject: `TerrainDesk payment completed - ${session.metadata?.plan || "Plan"}`,
        html: `
          <div style="font-family:Arial,sans-serif;color:#17201b;line-height:1.55">
            <h1>Payment completed</h1>
            <p><strong>Plan:</strong> ${escapeHtml(session.metadata?.plan)}</p>
            <p><strong>Customer:</strong> ${escapeHtml(session.customer_details?.email)}</p>
            <p><strong>Checkout session:</strong> ${escapeHtml(session.id)}</p>
          </div>
        `,
        text: `Payment completed for ${session.customer_details?.email || "unknown customer"}`
      });
    }
  }

  sendJson(res, 200, { received: true });
}

async function handleApiFile(route, req, res) {
  const handler = require(path.join(ROOT, route));
  return handler(req, res);
}

function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const requestedPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.normalize(path.join(ROOT, requestedPath));

  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }

  fs.readFile(filePath, (error, data) => {
    if (error) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      "content-type": MIME_TYPES[ext] || "application/octet-stream",
      "cache-control": "no-store"
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "POST" && url.pathname === "/api/demo-request") {
      return await handleDemoRequest(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/client-intake") {
      return await handleClientIntake(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/create-checkout-session") {
      return await handleCheckout(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/stripe-webhook") {
      return await handleStripeWebhook(req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/customer-message") {
      return await handleApiFile("api/customer-message.js", req, res);
    }
    if (req.method === "GET" && url.pathname === "/api/admin-customers") {
      return await handleApiFile("api/admin-customers.js", req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/admin-create-customer") {
      return await handleApiFile("api/admin-create-customer.js", req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/admin-update-customer") {
      return await handleApiFile("api/admin-update-customer.js", req, res);
    }
    if (req.method === "POST" && url.pathname === "/api/send-workspace-link") {
      return await handleApiFile("api/send-workspace-link.js", req, res);
    }
    if (req.method === "GET") {
      return serveStatic(req, res);
    }
    sendJson(res, 405, { ok: false, error: "Method not allowed." });
  } catch (error) {
    sendJson(res, 500, { ok: false, error: error.message || "Server error." });
  }
});

server.listen(PORT, () => {
  console.log(`TerrainDesk server running on http://localhost:${PORT}`);
});

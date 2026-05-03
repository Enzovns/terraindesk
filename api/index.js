const crypto = require("node:crypto");

const plans = {
  Essential: { label: "Essential", priceEnv: "STRIPE_PRICE_ESSENTIAL_AUD" },
  Operations: { label: "Operations", priceEnv: "STRIPE_PRICE_OPERATIONS_AUD" },
  "Multi-crew": { label: "Multi-crew", priceEnv: "STRIPE_PRICE_MULTI_CREW_AUD" }
};

const planPrices = { Essential: 149, Operations: 329, "Multi-crew": 799 };
const defaultAutomationSettings = {
  quoteFollowUp: true,
  crewReminder: true,
  photoRequest: true,
  reviewRequest: true,
  invoiceReminder: true,
  marginAlert: true
};

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

function getOrigin(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

function money(value) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
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

async function sendResendEmail({ to, replyTo, subject, html, text }) {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL;
  if (!apiKey || !from) throw new Error("Missing RESEND_API_KEY or RESEND_FROM_EMAIL.");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to: Array.isArray(to) ? to : [to], reply_to: replyTo, subject, html, text })
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.message || data?.error || "Resend rejected the email.");
  return data;
}

async function supabaseFetch(path, options = {}) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
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
  if (!response.ok) throw new Error(data?.message || data?.error_description || data?.error || "Supabase request failed.");
  return data;
}

async function supabaseAuthAdmin(path, options = {}) {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) throw new Error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
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
    const error = new Error(data?.msg || data?.message || data?.error_description || data?.error || "Supabase Auth request failed.");
    error.status = response.status;
    throw error;
  }
  return data;
}

async function getAuthedProfile(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Missing auth token.");
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY;
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: { apikey: key, authorization: `Bearer ${token}` }
  });
  const user = await response.json().catch(() => null);
  if (!response.ok || !user?.id) throw new Error("Invalid Supabase session.");
  const profiles = await supabaseFetch(`/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=*`);
  if (!profiles.length) throw new Error("Profile not found.");
  return { profile: profiles[0], user };
}

function requireAdmin(req) {
  const expected = process.env.ADMIN_API_KEY;
  if (!expected) throw new Error("Missing ADMIN_API_KEY.");
  if (req.headers["x-admin-key"] !== expected) {
    const error = new Error("Unauthorized admin request.");
    error.status = 401;
    throw error;
  }
}

async function generateWorkspaceLink(email, origin, type = "invite") {
  try {
    return await supabaseAuthAdmin("/admin/generate_link", {
      method: "POST",
      body: JSON.stringify({ type, email, redirect_to: `${origin}/app.html` })
    });
  } catch (error) {
    if (type !== "invite") throw error;
    return supabaseAuthAdmin("/admin/generate_link", {
      method: "POST",
      body: JSON.stringify({ type: "magiclink", email, redirect_to: `${origin}/app.html` })
    });
  }
}

function verifyStripeSignature(rawBody, signatureHeader) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !signatureHeader) return false;
  const parts = Object.fromEntries(signatureHeader.split(",").map((part) => part.split("=")));
  if (!parts.t || !parts.v1) return false;
  const digest = crypto.createHmac("sha256", secret).update(`${parts.t}.${rawBody}`).digest("hex");
  return crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(parts.v1));
}

async function handleConfig(req, res) {
  if (req.method !== "GET") return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) return sendJson(res, 500, { ok: false, error: "Missing Supabase public config." });
  return sendJson(res, 200, { ok: true, supabaseUrl, supabaseAnonKey });
}

async function handleDemoRequest(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  const body = await readJson(req);
  if (!isEmail(body.email)) return sendJson(res, 422, { ok: false, error: "A valid work email is required." });
  const to = process.env.DEMO_TO_EMAIL;
  if (!to) return sendJson(res, 500, { ok: false, error: "Missing DEMO_TO_EMAIL." });
  const html = `<h1>New TerrainDesk demo request</h1><p>${escapeHtml(body.email)} requested ${escapeHtml(body.plan || "Operations")}.</p>`;
  const result = await sendResendEmail({ to, replyTo: body.email, subject: `TerrainDesk demo request - ${body.plan || "Operations"}`, html, text: `Demo request from ${body.email}` });
  return sendJson(res, 200, { ok: true, id: result.id });
}

async function handleClientIntake(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  const body = await readJson(req);
  if (!isEmail(body.email) || !body.company) return sendJson(res, 422, { ok: false, error: "Company and valid contact email are required." });
  const to = process.env.ONBOARDING_TO_EMAIL || process.env.DEMO_TO_EMAIL;
  if (!to) return sendJson(res, 500, { ok: false, error: "Missing ONBOARDING_TO_EMAIL or DEMO_TO_EMAIL." });
  const html = `<h1>Paid client onboarding submitted</h1><p>${escapeHtml(body.company)} - ${escapeHtml(body.email)}</p>`;
  const result = await sendResendEmail({ to, replyTo: body.email, subject: `TerrainDesk paid onboarding - ${body.company}`, html, text: `Paid onboarding submitted by ${body.company}` });
  return sendJson(res, 200, { ok: true, id: result.id });
}

async function handleCheckout(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  const body = await readJson(req);
  const plan = plans[body.plan] || plans.Operations;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env[plan.priceEnv];
  if (!stripeKey) return sendJson(res, 500, { ok: false, error: "Missing STRIPE_SECRET_KEY." });
  if (!priceId) return sendJson(res, 500, { ok: false, error: `Missing ${plan.priceEnv}.` });
  const origin = getOrigin(req);
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
  const stripeResponse = await fetch("https://api.stripe.com/v1/checkout/sessions", {
    method: "POST",
    headers: { authorization: `Bearer ${stripeKey}`, "content-type": "application/x-www-form-urlencoded" },
    body: params
  });
  const data = await stripeResponse.json().catch(() => ({}));
  if (!stripeResponse.ok) return sendJson(res, stripeResponse.status, { ok: false, error: data.error?.message || "Stripe rejected checkout.", details: data });
  return sendJson(res, 200, { ok: true, url: data.url, id: data.id });
}

async function provisionPaidCustomer({ email, plan, stripeCustomerId, origin }) {
  let company = (await supabaseFetch(`/rest/v1/companies?stripe_customer_id=eq.${encodeURIComponent(stripeCustomerId)}&select=*`))[0];
  if (!company) {
    company = (await supabaseFetch("/rest/v1/companies", {
      method: "POST",
      body: JSON.stringify({ name: `${email.split("@")[0].replace(/[._-]+/g, " ")} Landscaping`, plan, stripe_customer_id: stripeCustomerId, subscription_status: "active" })
    }))[0];
  } else {
    company = (await supabaseFetch(`/rest/v1/companies?id=eq.${company.id}`, {
      method: "PATCH",
      body: JSON.stringify({ plan, subscription_status: "active" })
    }))[0] || company;
  }
  const link = await generateWorkspaceLink(email, origin, "invite");
  const userId = link.user?.id || link.properties?.user_id || link.properties?.user?.id;
  if (userId) {
    const existing = await supabaseFetch(`/rest/v1/profiles?id=eq.${userId}&select=id`);
    if (!existing.length) await supabaseFetch("/rest/v1/profiles", { method: "POST", body: JSON.stringify({ id: userId, company_id: company.id, email, role: "owner" }) });
  }
  await supabaseFetch("/rest/v1/automation_settings", {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ company_id: company.id, settings: defaultAutomationSettings })
  });
  return { company, actionLink: link.action_link || link.properties?.action_link };
}

async function handleStripeWebhook(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  const rawBody = await readRawBody(req);
  if (!verifyStripeSignature(rawBody, req.headers["stripe-signature"])) return sendJson(res, 400, { ok: false, error: "Invalid Stripe signature." });
  const event = JSON.parse(rawBody);
  if (event.type !== "checkout.session.completed") return sendJson(res, 200, { received: true, ignored: true });
  const session = event.data.object;
  const email = session.customer_details?.email || session.customer_email;
  const plan = session.metadata?.plan || session.client_reference_id || "Operations";
  if (!email || !session.customer) return sendJson(res, 422, { ok: false, error: "Missing Stripe customer email or customer id." });
  const provisioned = await provisionPaidCustomer({ email, plan, stripeCustomerId: session.customer, origin: getOrigin(req) });
  const owner = process.env.ONBOARDING_TO_EMAIL || process.env.DEMO_TO_EMAIL;
  if (owner) await sendResendEmail({ to: owner, replyTo: email, subject: `TerrainDesk payment completed - ${plan}`, html: `<h1>Payment completed</h1><p>${escapeHtml(email)} - ${escapeHtml(plan)} - A$${planPrices[plan] || 0}</p>` });
  if (provisioned.actionLink) await sendResendEmail({ to: email, subject: "Your TerrainDesk workspace is ready", html: `<h1>Your workspace is ready</h1><p><a href="${escapeHtml(provisioned.actionLink)}">Open TerrainDesk</a></p>` });
  return sendJson(res, 200, { received: true, companyId: provisioned.company.id });
}

async function handleBootstrapCompany(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  const { user } = await getAuthedProfileOrCreateUserOnly(req);
  const existing = await supabaseFetch(`/rest/v1/profiles?id=eq.${user.id}&select=id,company_id,email`);
  if (existing.length) return sendJson(res, 200, { ok: true, profile: existing[0], created: false });
  const company = (await supabaseFetch("/rest/v1/companies", { method: "POST", body: JSON.stringify({ name: cleanCompanyName(user.email), plan: "Operations", subscription_status: "active" }) }))[0];
  const profile = (await supabaseFetch("/rest/v1/profiles", { method: "POST", body: JSON.stringify({ id: user.id, company_id: company.id, email: user.email, role: "owner" }) }))[0];
  await supabaseFetch("/rest/v1/automation_settings", { method: "POST", body: JSON.stringify({ company_id: company.id, settings: defaultAutomationSettings }) });
  return sendJson(res, 200, { ok: true, profile, company, created: true });
}

async function getAuthedProfileOrCreateUserOnly(req) {
  const token = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!token) throw new Error("Missing Supabase access token.");
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, { headers: { apikey: anonKey, authorization: `Bearer ${token}` } });
  const user = await response.json().catch(() => null);
  if (!response.ok || !user?.id) throw new Error("Invalid Supabase session.");
  return { user };
}

function cleanCompanyName(email) {
  const prefix = String(email || "TerrainDesk Customer").split("@")[0];
  return `${prefix.replace(/[._-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())} Landscaping`;
}

async function handleUpdateCompany(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  const { profile } = await getAuthedProfile(req);
  const body = await readJson(req);
  const company = (await supabaseFetch(`/rest/v1/companies?id=eq.${profile.company_id}`, { method: "PATCH", body: JSON.stringify({ name: body.name, abn: body.abn }) }))[0];
  return sendJson(res, 200, { ok: true, company });
}

async function handleAdminCustomers(req, res) {
  if (req.method !== "GET") return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  requireAdmin(req);
  const [companies, profiles, leads, quotes, jobs, invoices] = await Promise.all([
    supabaseFetch("/rest/v1/companies?select=*&order=created_at.desc"),
    supabaseFetch("/rest/v1/profiles?select=*"),
    supabaseFetch("/rest/v1/leads?select=id,company_id,status"),
    supabaseFetch("/rest/v1/quotes?select=id,company_id,status,amount"),
    supabaseFetch("/rest/v1/jobs?select=id,company_id,status"),
    supabaseFetch("/rest/v1/invoices?select=id,company_id,status,amount")
  ]);
  return sendJson(res, 200, { ok: true, companies, profiles, leads, quotes, jobs, invoices });
}

async function handleAdminCreateCustomer(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  requireAdmin(req);
  const body = await readJson(req);
  const statusMap = { Active: "active", Onboarding: "onboarding", "At risk": "past_due" };
  const company = (await supabaseFetch("/rest/v1/companies", { method: "POST", body: JSON.stringify({ name: body.company, plan: body.plan, subscription_status: statusMap[body.status] || "onboarding" }) }))[0];
  const link = await generateWorkspaceLink(body.email, getOrigin(req), "invite");
  const actionLink = link.action_link || link.properties?.action_link;
  const userId = link.user?.id || link.properties?.user_id || link.properties?.user?.id;
  if (userId) await supabaseFetch("/rest/v1/profiles", { method: "POST", headers: { prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ id: userId, company_id: company.id, email: body.email, role: "owner" }) });
  await supabaseFetch("/rest/v1/automation_settings", { method: "POST", headers: { prefer: "resolution=merge-duplicates" }, body: JSON.stringify({ company_id: company.id, settings: defaultAutomationSettings }) });
  if (actionLink) await sendResendEmail({ to: body.email, subject: "Your TerrainDesk workspace is ready", html: `<h1>Welcome to TerrainDesk</h1><p><a href="${escapeHtml(actionLink)}">Open your workspace</a></p>` });
  return sendJson(res, 200, { ok: true, company, actionLink });
}

async function handleAdminUpdateCustomer(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  requireAdmin(req);
  const body = await readJson(req);
  const payload = {};
  for (const key of ["name", "abn", "plan", "subscription_status", "stripe_customer_id"]) if (body[key] !== undefined) payload[key] = body[key];
  const company = (await supabaseFetch(`/rest/v1/companies?id=eq.${body.companyId}`, { method: "PATCH", body: JSON.stringify(payload) }))[0];
  return sendJson(res, 200, { ok: true, company });
}

async function handleSendWorkspaceLink(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  requireAdmin(req);
  const body = await readJson(req);
  const link = await generateWorkspaceLink(body.email, getOrigin(req), "magiclink");
  const actionLink = link.action_link || link.properties?.action_link;
  if (!actionLink) return sendJson(res, 500, { ok: false, error: "Supabase did not return an action link." });
  await sendResendEmail({ to: body.email, subject: "Open your TerrainDesk workspace", html: `<h1>Open your TerrainDesk workspace</h1><p><a href="${escapeHtml(actionLink)}">Open TerrainDesk</a></p>` });
  return sendJson(res, 200, { ok: true, actionLink });
}

async function handleWorkspaceAction(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  const { profile } = await getAuthedProfile(req);
  const body = await readJson(req);
  if (body.action === "createLead") {
    const lead = (await supabaseFetch("/rest/v1/leads", { method: "POST", body: JSON.stringify({ company_id: profile.company_id, name: body.name, email: body.email, suburb: body.suburb || "", service: body.service || "Garden maintenance", urgency: body.urgency || "Flexible", status: "New" }) }))[0];
    return sendJson(res, 200, { ok: true, lead });
  }
  if (body.action === "createQuote") {
    const amount = Math.round((Number(body.hours || 1) * Number(body.rate || 85) + Number(body.materials || 0)) * (1 + Number(body.markup || 25) / 100) * 1.1);
    const quote = (await supabaseFetch("/rest/v1/quotes", { method: "POST", body: JSON.stringify({ company_id: profile.company_id, lead_id: body.leadId, service: body.service || "Garden maintenance", amount, status: "Sent" }) }))[0];
    await supabaseFetch("/rest/v1/jobs", {
      method: "POST",
      body: JSON.stringify({
        company_id: profile.company_id,
        lead_id: body.leadId,
        quote_id: quote.id,
        service: quote.service,
        amount,
        crew: body.employees || body.crew || "Unassigned",
        day: body.day || "Mon",
        status: "Proposed",
        checklist: ["Confirm access", "Load materials", "Before photos", "Client sign-off"]
      })
    });
    await supabaseFetch(`/rest/v1/leads?id=eq.${encodeURIComponent(body.leadId)}&company_id=eq.${encodeURIComponent(profile.company_id)}`, { method: "PATCH", body: JSON.stringify({ status: "Quoted" }) });
    return sendJson(res, 200, { ok: true, quote, amount });
  }
  if (body.action === "updateLead") {
    const lead = (await supabaseFetch(`/rest/v1/leads?id=eq.${encodeURIComponent(body.leadId)}&company_id=eq.${encodeURIComponent(profile.company_id)}`, { method: "PATCH", body: JSON.stringify({ status: body.status || "Contacted" }) }))[0];
    return sendJson(res, 200, { ok: true, lead });
  }
  if (body.action === "deleteLead") {
    const company = encodeURIComponent(profile.company_id);
    const lead = encodeURIComponent(body.leadId);
    await supabaseFetch(`/rest/v1/invoices?lead_id=eq.${lead}&company_id=eq.${company}`, { method: "DELETE" });
    await supabaseFetch(`/rest/v1/jobs?lead_id=eq.${lead}&company_id=eq.${company}`, { method: "DELETE" });
    await supabaseFetch(`/rest/v1/quotes?lead_id=eq.${lead}&company_id=eq.${company}`, { method: "DELETE" });
    await supabaseFetch(`/rest/v1/leads?id=eq.${lead}&company_id=eq.${company}`, { method: "DELETE" });
    return sendJson(res, 200, { ok: true });
  }
  if (body.action === "deleteQuote") {
    const company = encodeURIComponent(profile.company_id);
    const quote = encodeURIComponent(body.quoteId);
    await supabaseFetch(`/rest/v1/jobs?quote_id=eq.${quote}&company_id=eq.${company}`, { method: "DELETE" });
    await supabaseFetch(`/rest/v1/quotes?id=eq.${quote}&company_id=eq.${company}`, { method: "DELETE" });
    return sendJson(res, 200, { ok: true });
  }
  if (body.action === "scheduleQuote") {
    const quote = (await supabaseFetch(`/rest/v1/quotes?id=eq.${encodeURIComponent(body.quoteId)}&company_id=eq.${encodeURIComponent(profile.company_id)}&select=*`))[0];
    if (!quote) return sendJson(res, 404, { ok: false, error: "Quote not found." });
    if (quote.status !== "Accepted" && quote.status !== "Sent") {
      return sendJson(res, 422, { ok: false, error: "Only sent or accepted quotes can be scheduled." });
    }
    await supabaseFetch(`/rest/v1/quotes?id=eq.${encodeURIComponent(quote.id)}&company_id=eq.${encodeURIComponent(profile.company_id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "Scheduled" })
    });
    const proposed = await supabaseFetch(`/rest/v1/jobs?quote_id=eq.${encodeURIComponent(quote.id)}&company_id=eq.${encodeURIComponent(profile.company_id)}&status=eq.Proposed&select=*`);
    const job = proposed.length
      ? (await supabaseFetch(`/rest/v1/jobs?id=eq.${encodeURIComponent(proposed[0].id)}&company_id=eq.${encodeURIComponent(profile.company_id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "Scheduled", crew: body.employees || body.crew || proposed[0].crew, day: body.day || proposed[0].day || "Mon" })
      }))[0]
      : (await supabaseFetch("/rest/v1/jobs", {
        method: "POST",
        body: JSON.stringify({
          company_id: profile.company_id,
          lead_id: quote.lead_id,
          quote_id: quote.id,
          service: quote.service,
          amount: quote.amount,
          crew: body.employees || body.crew || "Unassigned",
          day: body.day || "Mon",
          status: "Scheduled",
          checklist: ["Confirm access", "Load materials", "Before photos", "Client sign-off"]
        })
      }))[0];
    return sendJson(res, 200, { ok: true, job });
  }
  if (body.action === "saveEmployees") {
    const existing = await supabaseFetch(`/rest/v1/automation_settings?company_id=eq.${encodeURIComponent(profile.company_id)}&select=*`);
    const current = existing[0]?.settings || {};
    const employees = String(body.employees || "").split(/\r?\n|,/).map((name) => name.trim()).filter(Boolean);
    await supabaseFetch("/rest/v1/automation_settings", {
      method: "POST",
      headers: { prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({ company_id: profile.company_id, settings: { ...current, employees } })
    });
    return sendJson(res, 200, { ok: true, employees });
  }
  if (body.action === "updateJob") {
    const job = (await supabaseFetch(`/rest/v1/jobs?id=eq.${encodeURIComponent(body.jobId)}&company_id=eq.${encodeURIComponent(profile.company_id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status: body.status })
    }))[0];
    return sendJson(res, 200, { ok: true, job });
  }
  if (body.action === "createInvoice") {
    const job = (await supabaseFetch(`/rest/v1/jobs?id=eq.${encodeURIComponent(body.jobId)}&company_id=eq.${encodeURIComponent(profile.company_id)}&select=*`))[0];
    if (!job) return sendJson(res, 404, { ok: false, error: "Job not found." });
    const invoice = (await supabaseFetch("/rest/v1/invoices", {
      method: "POST",
      body: JSON.stringify({
        company_id: profile.company_id,
        lead_id: job.lead_id,
        amount: job.amount,
        due: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
        status: "Unpaid"
      })
    }))[0];
    return sendJson(res, 200, { ok: true, invoice });
  }
  if (body.action === "updateInvoice") {
    const invoice = (await supabaseFetch(`/rest/v1/invoices?id=eq.${encodeURIComponent(body.invoiceId)}&company_id=eq.${encodeURIComponent(profile.company_id)}`, {
      method: "PATCH",
      body: JSON.stringify({ status: body.status })
    }))[0];
    return sendJson(res, 200, { ok: true, invoice });
  }
  return sendJson(res, 422, { ok: false, error: "Unknown workspace action." });
}

async function handlePublicLead(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  const body = await readJson(req);
  if (!body.companyId || !body.name || !body.email) return sendJson(res, 422, { ok: false, error: "Company, name and email are required." });
  const companies = await supabaseFetch(`/rest/v1/companies?id=eq.${encodeURIComponent(body.companyId)}&select=id,name`);
  if (!companies.length) return sendJson(res, 404, { ok: false, error: "Company not found." });
  const lead = (await supabaseFetch("/rest/v1/leads", { method: "POST", body: JSON.stringify({ company_id: body.companyId, name: body.name, email: body.email, suburb: body.suburb || "", service: body.service || "Lawn mowing", urgency: body.urgency || "Flexible", status: "New" }) }))[0];
  return sendJson(res, 200, { ok: true, company: companies[0], lead });
}

async function handleCustomerMessage(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  const { profile } = await getAuthedProfile(req);
  const body = await readJson(req);
  const lead = (await supabaseFetch(`/rest/v1/leads?id=eq.${encodeURIComponent(body.leadId)}&company_id=eq.${encodeURIComponent(profile.company_id)}&select=*`))[0];
  const company = (await supabaseFetch(`/rest/v1/companies?id=eq.${encodeURIComponent(profile.company_id)}&select=*`))[0] || {};
  if (!lead?.email) return sendJson(res, 422, { ok: false, error: "This client does not have an email address." });
  const subject = body.type === "quote" ? `${company.name || "TerrainDesk"} quote - ${body.service}` : body.type === "reminder" ? `Reminder from ${company.name || "TerrainDesk"}` : `${company.name || "TerrainDesk"} invoice - ${money(body.amount)}`;
  const quoteLink = `${getOrigin(req)}/quote.html?quote=${encodeURIComponent(body.quoteId || "")}`;
  const html = body.type === "quote"
    ? `<h1>Your landscaping quote</h1><p>Hi ${escapeHtml(lead.name)}, your quote for ${escapeHtml(body.service)} is <strong>${escapeHtml(money(body.amount))}</strong> inc. GST.</p><p><a href="${escapeHtml(quoteLink)}">Review, accept or decline this quote</a></p>`
    : body.type === "reminder"
      ? `<h1>Quick reminder</h1><p>Hi ${escapeHtml(lead.name)}, friendly reminder about your outstanding invoice for <strong>${escapeHtml(money(body.amount))}</strong>.</p>`
      : `<h1>Your invoice</h1><p>Hi ${escapeHtml(lead.name)}, your invoice is <strong>${escapeHtml(money(body.amount))}</strong>. Due ${escapeHtml(body.due || "soon")}.</p>`;
  const result = await sendResendEmail({ to: lead.email, replyTo: profile.email, subject, html, text: subject });
  return sendJson(res, 200, { ok: true, id: result.id });
}

async function handlePublicQuote(req, res) {
  const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
  const body = req.method === "POST" ? await readJson(req) : {};
  const quoteId = url.searchParams.get("quote") || body.quoteId || "";
  if (!quoteId) return sendJson(res, 422, { ok: false, error: "quote is required." });

  const quote = (await supabaseFetch(`/rest/v1/quotes?id=eq.${encodeURIComponent(quoteId)}&select=*`))[0];
  if (!quote) return sendJson(res, 404, { ok: false, error: "Quote not found." });
  const lead = (await supabaseFetch(`/rest/v1/leads?id=eq.${encodeURIComponent(quote.lead_id)}&select=*`))[0] || {};
  const company = (await supabaseFetch(`/rest/v1/companies?id=eq.${encodeURIComponent(quote.company_id)}&select=*`))[0] || {};
  const proposedJob = (await supabaseFetch(`/rest/v1/jobs?quote_id=eq.${encodeURIComponent(quote.id)}&select=*`))[0] || null;

  if (req.method === "GET") return sendJson(res, 200, { ok: true, quote, lead, company, proposedJob });
  if (req.method !== "POST") return sendJson(res, 405, { ok: false, error: "Method not allowed." });

  const nextStatus = body.decision === "decline" ? "Declined" : "Accepted";
  const updated = (await supabaseFetch(`/rest/v1/quotes?id=eq.${encodeURIComponent(quote.id)}`, {
    method: "PATCH",
    body: JSON.stringify({ status: nextStatus })
  }))[0];
  if (body.decision === "decline") {
    await supabaseFetch(`/rest/v1/jobs?quote_id=eq.${encodeURIComponent(quote.id)}&status=eq.Proposed`, { method: "DELETE" });
  } else {
    await supabaseFetch(`/rest/v1/jobs?quote_id=eq.${encodeURIComponent(quote.id)}&status=eq.Proposed`, {
      method: "PATCH",
      body: JSON.stringify({ status: "Scheduled" })
    });
  }
  return sendJson(res, 200, { ok: true, quote: updated, decision: nextStatus });
}

const routes = {
  "config": handleConfig,
  "demo-request": handleDemoRequest,
  "create-checkout-session": handleCheckout,
  "client-intake": handleClientIntake,
  "bootstrap-company": handleBootstrapCompany,
  "update-company": handleUpdateCompany,
  "stripe-webhook": handleStripeWebhook,
  "admin-customers": handleAdminCustomers,
  "admin-create-customer": handleAdminCreateCustomer,
  "admin-update-customer": handleAdminUpdateCustomer,
  "send-workspace-link": handleSendWorkspaceLink,
  "workspace-action": handleWorkspaceAction,
  "public-lead": handlePublicLead,
  "customer-message": handleCustomerMessage,
  "public-quote": handlePublicQuote
};

module.exports = async function handler(req, res) {
  try {
    const url = new URL(req.url, `https://${req.headers.host || "localhost"}`);
    const route = String(url.searchParams.get("path") || "").replace(/^api\//, "").replace(/^\/+/, "");
    const routeKey = route || url.pathname.replace(/^\/api\/?/, "");
    const fn = routes[routeKey];
    if (!fn) return sendJson(res, 404, { ok: false, error: `Unknown API route: ${routeKey}` });
    return await fn(req, res);
  } catch (error) {
    return sendJson(res, error.status || 500, { ok: false, error: error.message || "Server error." });
  }
};

module.exports.config = { api: { bodyParser: false } };

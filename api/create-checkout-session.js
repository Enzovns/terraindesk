const plans = {
  Essential: {
    label: "Essential",
    priceEnv: "STRIPE_PRICE_ESSENTIAL_AUD"
  },
  Operations: {
    label: "Operations",
    priceEnv: "STRIPE_PRICE_OPERATIONS_AUD"
  },
  "Multi-crew": {
    label: "Multi-crew",
    priceEnv: "STRIPE_PRICE_MULTI_CREW_AUD"
  }
};

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(payload));
}

function getOrigin(req) {
  const proto = req.headers["x-forwarded-proto"] || "https";
  const host = req.headers["x-forwarded-host"] || req.headers.host;
  return `${proto}://${host}`;
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
  const plan = plans[body.plan] || plans.Operations;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env[plan.priceEnv];

  if (!stripeKey) {
    return sendJson(res, 500, { ok: false, error: "Missing STRIPE_SECRET_KEY in Vercel environment variables." });
  }

  if (!priceId) {
    return sendJson(res, 500, { ok: false, error: `Missing ${plan.priceEnv} in Vercel environment variables.` });
  }

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
    headers: {
      authorization: `Bearer ${stripeKey}`,
      "content-type": "application/x-www-form-urlencoded"
    },
    body: params
  });

  const data = await stripeResponse.json().catch(() => ({}));
  if (!stripeResponse.ok) {
    return sendJson(res, stripeResponse.status, {
      ok: false,
      error: data.error?.message || "Stripe rejected the checkout session.",
      details: data
    });
  }

  return sendJson(res, 200, { ok: true, url: data.url, id: data.id });
};

const {
  escapeHtml,
  generateWorkspaceLink,
  getOrigin,
  readRawBody,
  sendJson,
  sendResendEmail,
  supabaseFetch,
  verifyStripeSignature
} = require("./_shared");

const planPrices = {
  Essential: 149,
  Operations: 329,
  "Multi-crew": 799
};

async function upsertPaidCustomer({ email, plan, stripeCustomerId, origin }) {
  const companies = await supabaseFetch(`/rest/v1/companies?stripe_customer_id=eq.${encodeURIComponent(stripeCustomerId)}&select=*`);
  let company = companies[0];

  if (!company) {
    const created = await supabaseFetch("/rest/v1/companies", {
      method: "POST",
      body: JSON.stringify({
        name: `${email.split("@")[0].replace(/[._-]+/g, " ")} Landscaping`,
        plan,
        stripe_customer_id: stripeCustomerId,
        subscription_status: "active"
      })
    });
    company = created[0];
  } else {
    const updated = await supabaseFetch(`/rest/v1/companies?id=eq.${company.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        plan,
        subscription_status: "active"
      })
    });
    company = updated[0] || company;
  }

  const link = await generateWorkspaceLink(email, origin, "invite");
  const user = link.user || link.properties?.user || link;
  const userId = user.id;

  if (userId) {
    const existingProfiles = await supabaseFetch(`/rest/v1/profiles?id=eq.${userId}&select=id`);
    if (!existingProfiles.length) {
      await supabaseFetch("/rest/v1/profiles", {
        method: "POST",
        body: JSON.stringify({
          id: userId,
          company_id: company.id,
          email,
          role: "owner"
        })
      });
    }
  }

  const settings = {
    quoteFollowUp: true,
    crewReminder: true,
    photoRequest: true,
    reviewRequest: true,
    invoiceReminder: true,
    marginAlert: true
  };

  await supabaseFetch("/rest/v1/automation_settings", {
    method: "POST",
    headers: { prefer: "resolution=merge-duplicates,return=representation" },
    body: JSON.stringify({ company_id: company.id, settings })
  });

  return {
    company,
    actionLink: link.action_link || link.properties?.action_link,
    userId
  };
}

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    return sendJson(res, 405, { ok: false, error: "Method not allowed." });
  }

  try {
    const rawBody = await readRawBody(req);
    if (!verifyStripeSignature(rawBody, req.headers["stripe-signature"])) {
      return sendJson(res, 400, { ok: false, error: "Invalid Stripe signature." });
    }

    const event = JSON.parse(rawBody);
    if (event.type !== "checkout.session.completed") {
      return sendJson(res, 200, { received: true, ignored: true });
    }

    const session = event.data.object;
    const email = session.customer_details?.email || session.customer_email;
    const plan = session.metadata?.plan || session.client_reference_id || "Operations";
    const stripeCustomerId = session.customer;

    if (!email || !stripeCustomerId) {
      return sendJson(res, 422, { ok: false, error: "Missing Stripe customer email or customer id." });
    }

    const origin = getOrigin(req);
    const provisioned = await upsertPaidCustomer({ email, plan, stripeCustomerId, origin });
    const onboardingRecipient = process.env.ONBOARDING_TO_EMAIL || process.env.DEMO_TO_EMAIL;

    if (onboardingRecipient) {
      await sendResendEmail({
        to: onboardingRecipient,
        replyTo: email,
        subject: `TerrainDesk payment completed - ${plan}`,
        html: `
          <div style="font-family:Arial,sans-serif;color:#17201b;line-height:1.55">
            <h1>Payment completed</h1>
            <p><strong>Email:</strong> ${escapeHtml(email)}</p>
            <p><strong>Plan:</strong> ${escapeHtml(plan)}</p>
            <p><strong>MRR:</strong> A$${escapeHtml(planPrices[plan] || 0)}</p>
            <p><strong>Company:</strong> ${escapeHtml(provisioned.company.name)}</p>
            <p><strong>Workspace link:</strong> ${escapeHtml(provisioned.actionLink || `${origin}/app.html`)}</p>
          </div>
        `,
        text: `Payment completed for ${email} on ${plan}. Workspace: ${provisioned.actionLink || `${origin}/app.html`}`
      });
    }

    if (provisioned.actionLink) {
      await sendResendEmail({
        to: email,
        subject: "Your TerrainDesk workspace is ready",
        html: `
          <div style="font-family:Arial,sans-serif;color:#17201b;line-height:1.55">
            <h1>Your TerrainDesk workspace is ready</h1>
            <p>Your ${escapeHtml(plan)} workspace has been created.</p>
            <p><a href="${escapeHtml(provisioned.actionLink)}">Open your workspace</a></p>
          </div>
        `,
        text: `Your TerrainDesk workspace is ready: ${provisioned.actionLink}`
      });
    }

    return sendJson(res, 200, { received: true, companyId: provisioned.company.id });
  } catch (error) {
    return sendJson(res, error.status || 500, { ok: false, error: error.message, details: error.data });
  }
};

module.exports.config = {
  api: {
    bodyParser: false
  }
};

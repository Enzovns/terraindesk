# TerrainDesk launch setup

## What is wired

- `server.js` serves the website on `http://localhost:8787`.
- `/api/demo-request` sends demo leads through Resend.
- `/api/create-checkout-session` creates Stripe Checkout sessions for paid plans.
- `/api/stripe-webhook` accepts Stripe `checkout.session.completed` events and emails the team.
- `/client.html` is the post-payment onboarding page for customers who paid today.
- `/api/client-intake` emails the paid customer onboarding brief through Resend.
- `/api/config` exposes the public Supabase URL and anon key to the browser.
- `/api/bootstrap-company` provisions a company/profile for a newly signed-in Supabase user.
- `/api/update-company` updates company settings using the Supabase service role.

## Required Supabase setup

Supabase requires:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

The browser app uses `SUPABASE_ANON_KEY` with Row Level Security. Serverless API routes use `SUPABASE_SERVICE_ROLE_KEY` only for provisioning and company settings updates.

## Required Resend setup

Resend requires:

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL`
- `DEMO_TO_EMAIL`
- `ONBOARDING_TO_EMAIL`

The sending email must be on a verified Resend domain. Resend's official docs say you need an API key and a verified domain before sending production email.

## Required Stripe setup

Stripe Checkout requires AUD recurring Prices:

- `STRIPE_SECRET_KEY`
- `STRIPE_PRICE_ESSENTIAL_AUD`
- `STRIPE_PRICE_OPERATIONS_AUD`
- `STRIPE_PRICE_MULTI_CREW_AUD`

Create recurring Stripe Prices in Australian dollars for the plans, then put the AUD price IDs in `.env`.

For production, add this webhook endpoint in Stripe:

```text
https://yourdomain.com/api/stripe-webhook
```

Then set:

```text
STRIPE_WEBHOOK_SECRET=whsec_...
```

## Local run

Create `.env` in this folder using `.env.example` as the field list, then run:

```bash
node server.js
```

Open:

```text
http://localhost:8787
```

The static `file://` version still opens, but real Resend and Stripe actions only work through the Node server.

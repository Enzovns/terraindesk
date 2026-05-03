# TerrainDesk launch setup

## What is wired

- `server.js` serves the website on `http://localhost:8787`.
- `/api/demo-request` sends demo leads through Resend.
- `/api/create-checkout-session` creates Stripe Checkout sessions for paid plans.
- `/api/stripe-webhook` accepts Stripe `checkout.session.completed` events and emails the team.
- `/api/stripe-webhook` also provisions the paid customer in Supabase and sends their workspace access email.
- `/client.html` is the post-payment onboarding page for customers who paid today.
- `/api/client-intake` emails the paid customer onboarding brief through Resend.
- `/api/config` exposes the public Supabase URL and anon key to the browser.
- `/api/bootstrap-company` provisions a company/profile for a newly signed-in Supabase user.
- `/api/update-company` updates company settings using the Supabase service role.
- `/admin.html` is the private founder admin panel.
- `/api/admin-customers`, `/api/admin-create-customer`, `/api/admin-update-customer` and `/api/send-workspace-link` power the admin panel through Supabase.
- `/api/customer-message` sends authenticated client emails for quotes, invoices and payment reminders through Resend.
- `/api/workspace-action` handles authenticated lead and quote creation/deletion through the Supabase service role.
- `/book.html?company=COMPANY_ID` is the public request form a landscaper can share with their own customers.
- `/api/public-lead` takes public booking form submissions and creates new leads in the landscaper workspace.
- `/quote.html?quote=QUOTE_ID` lets the landscaper's customer review, accept or decline a quote.
- `/api/public-quote` powers public quote review and acceptance.
- Vercel Hobby limit safe: all API routes are consolidated into one Serverless Function at `/api/index.js`, with rewrites preserving the existing `/api/...` URLs.

## Client workspace workflows

The client app now supports the first paid-customer operating loop:

- create leads
- receive public booking requests as leads
- mark leads contacted
- delete leads and related records
- create GST-aware AUD quotes
- delete quotes
- email quotes to clients
- accept quotes and generate scheduled jobs
- move jobs through scheduled, in progress, blocked and complete
- generate invoices from completed jobs
- email invoices and payment reminders
- mark invoices paid
- toggle automation rules
- save company settings

## Required Supabase setup

Supabase requires:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

The browser app uses `SUPABASE_ANON_KEY` with Row Level Security. Serverless API routes use `SUPABASE_SERVICE_ROLE_KEY` only for provisioning and company settings updates.

For account emails, Supabase Auth still needs a working email provider. In Supabase, configure Auth SMTP with your Resend SMTP details, or temporarily disable "Confirm email" while testing. The app can send workspace links through Resend, but Supabase account confirmation emails are controlled by Supabase Auth.

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

The webhook must listen to:

```text
checkout.session.completed
```

## Required admin setup

Set:

```text
ADMIN_API_KEY=your-long-private-key
```

Open:

```text
https://yourdomain.com/admin.html
```

Use that key to unlock the admin panel. Keep `ADMIN_API_KEY` private. It is only checked by serverless API routes and should not be shown on the public site.

## Vercel production variables

Add these exact variables in Vercel Project Settings -> Environment Variables:

```text
RESEND_API_KEY
RESEND_FROM_EMAIL
DEMO_TO_EMAIL
ONBOARDING_TO_EMAIL
ADMIN_API_KEY
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
STRIPE_SECRET_KEY
STRIPE_PRICE_ESSENTIAL_AUD
STRIPE_PRICE_OPERATIONS_AUD
STRIPE_PRICE_MULTI_CREW_AUD
STRIPE_WEBHOOK_SECRET
```

Redeploy after adding or changing them.

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

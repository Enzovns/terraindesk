const params = new URLSearchParams(window.location.search);
const quoteId = params.get("quote");
const title = document.querySelector("#quote-title");
const total = document.querySelector("#quote-total");
const copy = document.querySelector("#quote-copy");
const statusEl = document.querySelector("#quote-status");
const acceptButton = document.querySelector("#accept-quote");
const showRevisionButton = document.querySelector("#show-revision");
const revisionForm = document.querySelector("#revision-form");
const dayEl = document.querySelector("#quote-day");
const scopeEl = document.querySelector("#quote-scope");
const companyEl = document.querySelector("#quote-company");

function money(value) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0
  }).format(Number(value || 0));
}

async function loadQuote() {
  if (!quoteId) throw new Error("Missing quote id.");
  const response = await fetch(`/api/public-quote?quote=${encodeURIComponent(quoteId)}`);
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Could not load quote.");
  title.textContent = result.quote.service;
  total.textContent = money(result.quote.amount);
  const companyName = result.company.name || "The landscaping team";
  const proposed = result.proposedJob || {};
  copy.textContent = `${companyName} sent this quote to ${result.lead.name || "you"}. Accepting confirms both the price and the proposed appointment.`;
  dayEl.textContent = proposed.day || "To be confirmed";
  scopeEl.textContent = result.quote.service || "Landscaping work";
  companyEl.textContent = companyName;
  const closed = ["Accepted", "Declined", "Scheduled", "Revision requested"].includes(result.quote.status);
  acceptButton.disabled = closed;
  showRevisionButton.disabled = closed;
  statusEl.textContent = closed ? `Current status: ${result.quote.status}.` : "Please accept or decline below.";
}

async function decide(decision, extra = {}) {
  statusEl.textContent = "Sending response...";
  const response = await fetch("/api/public-quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ quoteId, decision, ...extra })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Could not update quote.");
  statusEl.textContent = decision === "decline"
    ? "Quote declined. The landscaping team can follow up if needed."
    : "Quote accepted. The appointment is now confirmed with the landscaping team.";
  await loadQuote();
}

acceptButton.addEventListener("click", () => decide("accept").catch((error) => {
  statusEl.textContent = error.message;
}));

showRevisionButton.addEventListener("click", () => {
  revisionForm.hidden = false;
  showRevisionButton.hidden = true;
});

revisionForm.addEventListener("submit", (event) => {
  event.preventDefault();
  decide("decline", Object.fromEntries(new FormData(revisionForm))).catch((error) => {
    statusEl.textContent = error.message;
  });
});

loadQuote().catch((error) => {
  title.textContent = "Quote unavailable";
  copy.textContent = error.message;
  acceptButton.disabled = true;
  showRevisionButton.disabled = true;
});

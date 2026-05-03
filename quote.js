const params = new URLSearchParams(window.location.search);
const quoteId = params.get("quote");
const title = document.querySelector("#quote-title");
const total = document.querySelector("#quote-total");
const copy = document.querySelector("#quote-copy");
const statusEl = document.querySelector("#quote-status");
const acceptButton = document.querySelector("#accept-quote");
const declineButton = document.querySelector("#decline-quote");

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
  copy.textContent = `${result.company.name || "The landscaping team"} sent this quote to ${result.lead.name || "you"}. Current status: ${result.quote.status}.`;
  const closed = ["Accepted", "Declined", "Scheduled"].includes(result.quote.status);
  acceptButton.disabled = closed;
  declineButton.disabled = closed;
}

async function decide(decision) {
  statusEl.textContent = "Sending response...";
  const response = await fetch("/api/public-quote", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ quoteId, decision })
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Could not update quote.");
  statusEl.textContent = decision === "decline"
    ? "Quote declined. The landscaping team can follow up if needed."
    : "Quote accepted. The landscaping team will schedule the job next.";
  await loadQuote();
}

acceptButton.addEventListener("click", () => decide("accept").catch((error) => {
  statusEl.textContent = error.message;
}));

declineButton.addEventListener("click", () => decide("decline").catch((error) => {
  statusEl.textContent = error.message;
}));

loadQuote().catch((error) => {
  title.textContent = "Quote unavailable";
  copy.textContent = error.message;
  acceptButton.disabled = true;
  declineButton.disabled = true;
});

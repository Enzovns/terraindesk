const form = document.querySelector("#booking-form");
const statusEl = document.querySelector("#booking-status");
const params = new URLSearchParams(window.location.search);
const companyId = params.get("company") || params.get("c");

if (!companyId) {
  form.querySelector("button").disabled = true;
  statusEl.textContent = "This booking link is missing a company id.";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusEl.textContent = "Sending request...";
  const payload = Object.fromEntries(new FormData(form));
  try {
    const response = await fetch("/api/public-lead", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...payload, companyId })
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Could not send request.");
    form.reset();
    statusEl.textContent = "Request sent. The landscaping team will follow up soon.";
  } catch (error) {
    statusEl.textContent = error.message;
  }
});

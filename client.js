const toast = document.querySelector("#toast");
const params = new URLSearchParams(window.location.search);
const plan = params.get("plan") || "Operations";
let toastTimer;

document.querySelector("#client-plan").textContent = plan;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 3200);
}

document.querySelector("#client-intake").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form));
  payload.plan = plan;
  payload.checkoutSession = params.get("session_id") || "";

  if (!window.location.protocol.startsWith("http")) {
    showToast("Run the Node server to send this onboarding brief.");
    return;
  }

  try {
    const response = await fetch("/api/client-intake", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "Onboarding email failed.");
    }
    form.reset();
    showToast(`Onboarding brief sent. Resend email id: ${result.id}.`);
  } catch (error) {
    showToast(error.message);
  }
});

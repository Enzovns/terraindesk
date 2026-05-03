const workflowContent = {
  lead: {
    label: "Automatic capture",
    title: "Lead qualified in 2 minutes",
    text: "The client form captures service type, suburb, urgency and contact details, then creates a lead the owner can quote immediately.",
    metrics: ["84.2% complete", "6 fields captured", "1 priority call"]
  },
  quote: {
    label: "Assisted quote",
    title: "Price, margin and options calculated",
    text: "TerrainDesk combines labour, materials, markup, GST and a proposed day into a quote the client can accept or revise.",
    metrics: ["27.8% margin", "A$8,740 proposed", "Tue booked"]
  },
  crew: {
    label: "Intelligent dispatch",
    title: "The right crew at the right time",
    text: "The schedule groups jobs by day, checks employee assignments, exports the route sheet and keeps the mobile work order ready.",
    metrics: ["42 km optimized", "3 members", "16 min saved"]
  },
  invoice: {
    label: "Closed cashflow",
    title: "Invoice sent after approval",
    text: "When the job is complete, the invoice can be generated, emailed, reminded, marked paid and exported to accounting.",
    metrics: ["92.6% approved", "D+0 invoice", "2 follow-ups"]
  }
};

const DEMO_RECIPIENT_EMAIL = "demo@terraindesk.com";
const hasBackend = window.location.protocol.startsWith("http");

const productContent = {
  sales: {
    label: "Sales pipeline",
    title: "From request to signed quote",
    text: "Capture leads, score urgency, create clean proposals and schedule the first visit without copying data between tools.",
    metrics: [
      ["New request", "14"],
      ["Site visit", "8"],
      ["Quote sent", "A$42.8k"],
      ["Won this week", "6"]
    ]
  },
  operations: {
    label: "Operations board",
    title: "Every crew, route and work order in one live board",
    text: "Dispatch teams, adjust jobs when weather changes, track materials and spot the bottleneck before a client calls asking for an update.",
    metrics: [
      ["Scheduled today", "19"],
      ["At risk", "3"],
      ["Depot runs", "2"],
      ["Utilization", "87%"]
    ]
  },
  finance: {
    label: "Finance desk",
    title: "Margins, deposits and invoices without the Friday-night cleanup",
    text: "See quote margin, trigger invoices after job completion and export clean records to accounting.",
    metrics: [
      ["Open invoices", "A$18.4k"],
      ["Paid invoices", "A$7.2k"],
      ["Gross margin", "31.8%"],
      ["Late follow-ups", "4"]
    ]
  }
};

const preview = document.querySelector("#workflow-preview");
const steps = document.querySelectorAll(".step");
const toast = document.querySelector("#toast");
let toastTimer;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 2600);
}

steps.forEach((step) => {
  step.addEventListener("click", () => {
    const content = workflowContent[step.dataset.step];
    steps.forEach((item) => item.classList.remove("active"));
    step.classList.add("active");
    preview.animate(
      [{ opacity: 0.62, transform: "translateY(8px)" }, { opacity: 1, transform: "translateY(0)" }],
      { duration: 260, easing: "cubic-bezier(.16, 1, .3, 1)" }
    );
    preview.innerHTML = `
      <span class="preview-label">${content.label}</span>
      <h3>${content.title}</h3>
      <p>${content.text}</p>
      <div class="preview-metrics">
        ${content.metrics.map((metric) => {
          const [value, ...rest] = metric.split(" ");
          return `<span><b>${value}</b> ${rest.join(" ")}</span>`;
        }).join("")}
      </div>
    `;
  });
});

const productPreview = document.querySelector("#product-preview");
const productTabs = document.querySelectorAll(".product-tab");

function renderProduct(key) {
  const content = productContent[key];
  productTabs.forEach((tab) => {
    const active = tab.dataset.product === key;
    tab.classList.toggle("active", active);
    tab.setAttribute("aria-selected", String(active));
  });
  productPreview.animate(
    [{ opacity: 0.62, transform: "translateY(8px)" }, { opacity: 1, transform: "translateY(0)" }],
    { duration: 260, easing: "cubic-bezier(.16, 1, .3, 1)" }
  );
  productPreview.innerHTML = `
    <div>
      <span class="preview-label">${content.label}</span>
      <h3>${content.title}</h3>
      <p>${content.text}</p>
    </div>
    <div class="module-board">
      ${content.metrics.map(([label, value]) => `<div><span>${label}</span><b>${value}</b></div>`).join("")}
    </div>
  `;
}

productTabs.forEach((tab) => {
  tab.addEventListener("click", () => renderProduct(tab.dataset.product));
});

const commands = [
  "Prepare an annual maintenance quote for 4 zones...",
  "Reorganize the route if rain arrives before 14:00...",
  "Generate a client follow-up with before/after photos...",
  "Compare margin between premium and standard mulch..."
];

const typedCommand = document.querySelector("#typed-command");
let commandIndex = 0;
let letterIndex = 0;
let deleting = false;

function typeLoop() {
  const current = commands[commandIndex];
  typedCommand.textContent = current.slice(0, letterIndex) + (letterIndex % 2 === 0 ? "|" : "");

  if (!deleting && letterIndex < current.length) {
    letterIndex += 1;
  } else if (!deleting) {
    deleting = true;
    setTimeout(typeLoop, 1400);
    return;
  } else if (letterIndex > 0) {
    letterIndex -= 1;
  } else {
    deleting = false;
    commandIndex = (commandIndex + 1) % commands.length;
  }

  setTimeout(typeLoop, deleting ? 24 : 42);
}

typeLoop();

const jobs = document.querySelector("#jobs");
const hours = document.querySelector("#hours");
const rate = document.querySelector("#rate");
const jobsValue = document.querySelector("#jobs-value");
const hoursValue = document.querySelector("#hours-value");
const rateValue = document.querySelector("#rate-value");
const roiValue = document.querySelector("#roi-value");

function formatMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "AUD",
    maximumFractionDigits: 0
  }).format(value);
}

function updateRoi() {
  const jobsNumber = Number(jobs.value);
  const hoursNumber = Number(hours.value);
  const rateNumber = Number(rate.value);
  const saved = jobsNumber * hoursNumber * rateNumber * 0.7;

  jobsValue.textContent = jobsNumber;
  hoursValue.textContent = hoursNumber;
  rateValue.textContent = formatMoney(rateNumber);
  roiValue.textContent = formatMoney(saved);
}

[jobs, hours, rate].forEach((input) => input.addEventListener("input", updateRoi));
updateRoi();

document.querySelectorAll("[data-open-demo]").forEach((button) => {
  button.addEventListener("click", () => {
    const plan = button.dataset.plan || "Operations";
    document.querySelector("#selected-plan").value = plan;
    const modal = document.querySelector("#demo-modal");
    if (typeof modal.showModal === "function") {
      modal.showModal();
    } else {
      showToast(`Demo request selected for ${plan}.`);
    }
  });
});

document.querySelector("[data-close-demo]").addEventListener("click", () => {
  document.querySelector("#demo-modal").close();
});

document.querySelector("#demo-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const data = new FormData(form);
  const email = data.get("email");
  const plan = data.get("plan");
  const size = data.get("size");
  const lead = {
    email,
    plan,
    size,
    monthlySavings: roiValue.textContent,
    createdAt: new Date().toISOString()
  };
  const savedLeads = JSON.parse(localStorage.getItem("terraindeskDemoRequests") || "[]");
  savedLeads.push(lead);
  localStorage.setItem("terraindeskDemoRequests", JSON.stringify(savedLeads));

  const subject = encodeURIComponent(`TerrainDesk demo request - ${plan}`);
  const body = encodeURIComponent(
    [
      "New TerrainDesk demo request",
      "",
      `Work email: ${email}`,
      `Company size: ${size}`,
      `Selected plan: ${plan}`,
      `Estimated monthly savings: ${roiValue.textContent}`,
      `Jobs per month: ${jobs.value}`,
      `Admin hours per job: ${hours.value}`,
      `Admin hourly cost: ${rateValue.textContent}`,
      "",
      "Source: static website demo form"
    ].join("\n")
  );

  document.querySelector("#demo-modal").close();
  form.reset();
  document.querySelector("#selected-plan").value = "Operations";
  if (!hasBackend) {
    showToast(`Demo request saved. Opening an email draft for ${DEMO_RECIPIENT_EMAIL}.`);
    window.location.href = `mailto:${DEMO_RECIPIENT_EMAIL}?subject=${subject}&body=${body}`;
    return;
  }

  try {
    const response = await fetch("/api/demo-request", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ...lead,
        jobs: jobs.value,
        hours: hours.value,
        rate: rateValue.textContent
      })
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.error || "Email delivery failed.");
    }
    showToast(`Demo request sent. Resend email id: ${result.id}.`);
  } catch (error) {
    showToast(error.message);
  }
});

document.querySelectorAll("[data-checkout-plan]").forEach((button) => {
  button.addEventListener("click", () => startCheckout(button.dataset.checkoutPlan));
});

async function startCheckout(plan) {
  const checkoutButton = document.querySelector(`[data-checkout-plan="${plan}"]`);
  const originalLabel = checkoutButton?.textContent;

  if (!hasBackend) {
    document.querySelector("#selected-plan").value = plan;
    document.querySelector("#demo-modal").showModal();
    showToast("Run the Node server to enable paid checkout.");
    return;
  }

  try {
    if (checkoutButton) {
      checkoutButton.disabled = true;
      checkoutButton.textContent = "Opening checkout...";
    }
    const response = await fetch("/api/create-checkout-session", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ plan })
    });
    const contentType = response.headers.get("content-type") || "";
    const result = contentType.includes("application/json")
      ? await response.json()
      : { error: await response.text() };
    if (!response.ok) {
      throw new Error(result.error || "Checkout could not be created.");
    }
    window.location.href = result.url;
  } catch (error) {
    showToast(error.message);
    if (checkoutButton) {
      checkoutButton.disabled = false;
      checkoutButton.textContent = originalLabel;
    }
  }
}

document.querySelector("#approve-quote").addEventListener("click", (event) => {
  const button = event.currentTarget;
  const quote = button.closest(".quote-card");
  quote.querySelector("span").textContent = "Approved quote";
  quote.querySelector("strong").textContent = "A$8,740 signed";
  button.style.background = "#73b987";
  showToast("Quote approved. Crew schedule and client confirmation are now queued.");
});

document.querySelectorAll(".task-list button, .check-row").forEach((button) => {
  button.addEventListener("click", () => {
    button.classList.toggle("done");
    const label = button.textContent.trim().replace(/\s+/g, " ");
    showToast(button.classList.contains("done") ? `${label} marked complete.` : `${label} reopened.`);
  });
});

document.querySelectorAll(".integration").forEach((button) => {
  button.addEventListener("click", () => {
    const name = button.childNodes[0].textContent.trim();
    showToast(`${name} integration selected. It will be included in the demo workspace.`);
  });
});

document.querySelectorAll(".feature").forEach((feature) => {
  feature.addEventListener("click", () => {
    const title = feature.querySelector("h3").textContent;
    showToast(`${title} added to your demo focus list.`);
  });
});

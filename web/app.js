// ---------- formatting helpers ----------

function fmtCAD(millions, opts = {}) {
  if (millions == null || Number.isNaN(millions)) return "—";
  const abs = Math.abs(millions);
  if (abs >= 1000) {
    return (opts.sign && millions > 0 ? "+" : millions < 0 ? "−" : "") +
      "$" + (abs / 1000).toFixed(1) + "B";
  }
  return (opts.sign && millions > 0 ? "+" : millions < 0 ? "−" : "") +
    "$" + abs.toLocaleString() + "M";
}

function fmtPct(cur, prior) {
  if (cur == null || prior == null || prior === 0) return "";
  const d = ((cur - prior) / Math.abs(prior)) * 100;
  const sign = d >= 0 ? "+" : "";
  return sign + d.toFixed(1) + "%";
}

function deltaClass(cur, prior, opts = {}) {
  // opts.goodUp: higher is good (e.g. revenues). If absent, default true.
  if (cur == null || prior == null) return "";
  const higher = cur > prior;
  const goodUp = opts.goodUp !== false;
  return higher === goodUp ? "good" : "bad";
}

// ---------- top-level spending categories we want to chart ----------
// Each entry: [label, matcher(lineItem) → bool, color]
const CATEGORY_SPEC = [
  ["Elderly benefits", (l) => /elderly benefits/i.test(l.label), "#f97316"],
  ["Employment Insurance", (l) => /^employment insurance benefits/i.test(l.label), "#fb923c"],
  ["Children's benefits", (l) => /children'?s benefits/i.test(l.label), "#fdba74"],
  ["Canada Health Transfer", (l) => /canada health transfer/i.test(l.label), "#60a5fa"],
  ["Canada Social Transfer", (l) => /canada social transfer/i.test(l.label), "#93c5fd"],
  ["Equalization", (l) => /^equalization/i.test(l.label), "#3b82f6"],
  ["Territorial Financing", (l) => /territorial formula financing/i.test(l.label), "#2563eb"],
  ["Child care", (l) => /early learning and child care/i.test(l.label), "#a78bfa"],
  ["Other transfer payments", (l) => /^other transfer payments/i.test(l.label), "#c084fc"],
  ["Operating expenses", (l) => /^operating expenses/i.test(l.label), "#34d399"],
  ["Public debt charges", (l) => /public debt charges/i.test(l.label), "#f87171"],
];

function buildBreakdown(lineItems) {
  const rows = [];
  for (const [name, matcher, color] of CATEGORY_SPEC) {
    const hit = lineItems.find((l) => matcher(l));
    if (hit && hit.ytd_current != null) {
      rows.push({ name, color, value: hit.ytd_current, prior: hit.ytd_prior });
    }
  }
  rows.sort((a, b) => b.value - a.value);
  return rows;
}

function renderBars(container, rows) {
  container.innerHTML = "";
  const max = Math.max(...rows.map((r) => r.value));
  for (const r of rows) {
    const pct = (r.value / max) * 100;
    const delta = fmtPct(r.value, r.prior);
    const deltaCls = deltaClass(r.value, r.prior, { goodUp: false });
    const row = document.createElement("div");
    row.className = "bar-row";
    row.innerHTML = `
      <div class="bar-label">${r.name}</div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${pct}%; background:${r.color}"></div>
      </div>
      <div class="bar-value">${fmtCAD(r.value)} <span class="delta ${deltaCls}">${delta}</span></div>
    `;
    container.appendChild(row);
  }
}

// ---------- debt charges running counter ----------

function startDebtClock(ytdCharges, periodLabel) {
  // Extract "April to October 2025-26" → assume start = April 1 of that FY.
  // We treat the number as charges accumulated from April 1 up through the end
  // of the reporting month. From now on, extrapolate linearly at the same rate.
  const el = document.getElementById("debt-clock");
  const rateEl = document.getElementById("debt-rate");

  const m = /April to (\w+) (\d{4})-(\d{2})/.exec(periodLabel || "");
  if (!m || ytdCharges == null) {
    el.textContent = fmtCAD(ytdCharges);
    return;
  }
  const monthNames = {January:1,February:2,March:3,April:4,May:5,June:6,July:7,August:8,September:9,October:10,November:11,December:12};
  const endMonth = monthNames[m[1]];
  const fyStartYear = parseInt(m[2], 10);
  // FY starts April 1 of fyStartYear
  const start = new Date(Date.UTC(fyStartYear, 3, 1)); // April = month 3 (0-indexed)
  // End of reporting month: last day of endMonth
  // Simpler: first day of month AFTER endMonth
  const end = new Date(Date.UTC(fyStartYear + (endMonth < 4 ? 1 : 0), endMonth, 1));

  const elapsedMs = end.getTime() - start.getTime();
  const chargesInDollars = ytdCharges * 1_000_000; // millions → dollars
  const dollarsPerMs = chargesInDollars / elapsedMs;
  const dollarsPerSecond = dollarsPerMs * 1000;

  rateEl.textContent =
    `≈ $${dollarsPerSecond.toLocaleString(undefined, { maximumFractionDigits: 0 })}/sec extrapolated from ${periodLabel}`;

  function tick() {
    const now = Date.now();
    const extrapolated = chargesInDollars + (now - end.getTime()) * dollarsPerMs;
    el.textContent = "$" + Math.floor(extrapolated).toLocaleString();
  }
  tick();
  setInterval(tick, 100);
}

// ---------- main ----------

async function load() {
  try {
    const [indexRes, fmRes] = await Promise.all([
      fetch("data/index.json", { cache: "no-store" }),
      fetch("data/fiscal_monitor.json", { cache: "no-store" }),
    ]);
    if (!indexRes.ok) throw new Error("index.json " + indexRes.status);
    if (!fmRes.ok) throw new Error("fiscal_monitor.json " + fmRes.status);

    const index = await indexRes.json();
    const fm = await fmRes.json();

    const period = fm.summary.period_labels.ytd_current || "";
    document.getElementById("period").textContent = period;

    // Headline balance
    const bb = fm.summary.budgetary_balance || {};
    const balanceEl = document.getElementById("balance");
    balanceEl.textContent = fmtCAD(bb.ytd_current);
    balanceEl.className = "big " + (bb.ytd_current < 0 ? "bad" : "good");

    const compareEl = document.getElementById("balance-compare");
    if (bb.ytd_current != null && bb.ytd_prior != null) {
      const worsened = bb.ytd_current < bb.ytd_prior;
      compareEl.innerHTML =
        `vs. ${fmtCAD(bb.ytd_prior)} same period last fiscal year ` +
        `<span class="delta ${worsened ? "bad" : "good"}">` +
        (worsened ? "▼ worse" : "▲ better") + "</span>";
    }

    // Revenues
    const rev = fm.summary.revenues || {};
    document.getElementById("revenues").textContent = fmtCAD(rev.ytd_current);
    document.getElementById("revenues-compare").innerHTML =
      `<span class="delta ${deltaClass(rev.ytd_current, rev.ytd_prior, { goodUp: true })}">` +
      fmtPct(rev.ytd_current, rev.ytd_prior) + "</span> vs. prior year";

    // Expenses
    const exp = fm.summary.program_expenses || {};
    document.getElementById("expenses").textContent = fmtCAD(exp.ytd_current);
    document.getElementById("expenses-compare").innerHTML =
      `<span class="delta ${deltaClass(exp.ytd_current, exp.ytd_prior, { goodUp: false })}">` +
      fmtPct(exp.ytd_current, exp.ytd_prior) + "</span> vs. prior year";

    // Debt charges clock
    const debt = fm.summary.public_debt_charges || {};
    startDebtClock(debt.ytd_current, period);

    // Spending breakdown
    const bars = buildBreakdown(fm.spending_breakdown.line_items || []);
    renderBars(document.getElementById("breakdown"), bars);

    // Source + updated
    document.getElementById("source-info").innerHTML =
      `Source: <a href="${fm.edition.url}">Department of Finance — ${fm.edition.name}</a>`;
    document.getElementById("last-updated").textContent =
      "Last refreshed: " + new Date(index.last_updated).toLocaleString();
  } catch (err) {
    document.getElementById("period").textContent = "Load error: " + err.message;
    console.error(err);
  }
}

load();

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

// ---------- hierarchical breakdown rendering ----------

// We want to skip "Total expenses" / "Total program expenses" subtotals that
// aren't directly useful as their own bar (they roll up other subtotals).
const ROLLUP_SKIP = [
  /^total expenses$/i,
  /^total expenses, excluding/i,
  /^total program expenses, excluding/i,
  /^net actuarial losses$/i,
];

const SECTION_COLORS = {
  "Major transfers to persons": "#f97316",
  "Major transfers to provinces, territories and municipalities": "#60a5fa",
  "Direct program expenses": "#a78bfa",
  "Other expenses": "#34d399",
  null: "#94a3b8",
  "": "#94a3b8",
};

function shouldSkip(item) {
  return ROLLUP_SKIP.some((re) => re.test(item.label));
}

function groupBySection(lineItems) {
  const groups = new Map();
  for (const item of lineItems) {
    if (shouldSkip(item)) continue;
    const key = item.section || "Other";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

function renderHierarchicalBreakdown(container, lineItems) {
  container.innerHTML = "";
  const groups = groupBySection(lineItems);

  // Find the largest single line-item value for consistent bar scaling.
  let max = 0;
  for (const items of groups.values()) {
    for (const it of items) {
      if (!it.is_subtotal && it.ytd_current != null && it.ytd_current > max) {
        max = it.ytd_current;
      }
    }
  }
  if (max === 0) max = 1;

  for (const [section, items] of groups.entries()) {
    const subtotal = items.find((i) => i.is_subtotal);
    const detail = items.filter((i) => !i.is_subtotal);
    if (detail.length === 0) continue;

    const color = SECTION_COLORS[section] || "#94a3b8";
    const sectionEl = document.createElement("div");
    sectionEl.className = "section";

    const sectionTitle = (section || "Other").replace(/, territories and municipalities$/, "");
    let subtotalHtml = "";
    if (subtotal) {
      const delta = fmtPct(subtotal.ytd_current, subtotal.ytd_prior);
      const cls = deltaClass(subtotal.ytd_current, subtotal.ytd_prior, { goodUp: false });
      subtotalHtml = `
        <div class="section-total">${fmtCAD(subtotal.ytd_current)}
          <span class="delta ${cls}">${delta}</span>
        </div>`;
    }

    sectionEl.innerHTML = `
      <div class="section-head">
        <div class="section-title" style="color:${color}">${sectionTitle}</div>
        ${subtotalHtml}
      </div>
    `;

    for (const it of detail) {
      if (it.ytd_current == null) continue;
      // Clean trailing footnote markers like "[1]" and odd spaces
      const cleanLabel = it.label.replace(/\s*\[\d+\]/g, "").trim();
      const pct = Math.max(1, (Math.abs(it.ytd_current) / max) * 100);
      const delta = fmtPct(it.ytd_current, it.ytd_prior);
      const deltaCls = deltaClass(it.ytd_current, it.ytd_prior, { goodUp: false });
      const negative = it.ytd_current < 0;
      const row = document.createElement("div");
      row.className = "bar-row";
      row.innerHTML = `
        <div class="bar-label">${cleanLabel}</div>
        <div class="bar-track">
          <div class="bar-fill${negative ? " negative" : ""}"
               style="width:${pct}%; background:${color}"></div>
        </div>
        <div class="bar-value">${fmtCAD(it.ytd_current)}
          <span class="delta ${deltaCls}">${delta}</span>
        </div>
      `;
      sectionEl.appendChild(row);
    }
    container.appendChild(sectionEl);
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

    // Spending breakdowns
    renderHierarchicalBreakdown(
      document.getElementById("breakdown-category"),
      fm.spending_by_category?.line_items || []
    );
    renderHierarchicalBreakdown(
      document.getElementById("breakdown-object"),
      fm.spending_by_object?.line_items || []
    );

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

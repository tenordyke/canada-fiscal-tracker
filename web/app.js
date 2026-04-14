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

function renderHierarchicalBreakdown(container, lineItems, extras = {}) {
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

    const wrapper = document.createElement("details");
    wrapper.className = "section";
    wrapper.open = true;
    wrapper.innerHTML = `
      <summary class="section-head">
        <span class="section-title" style="color:${color}">${sectionTitle}</span>
        ${subtotalHtml}
      </summary>
      <div class="section-body"></div>
    `;
    const body = wrapper.querySelector(".section-body");

    for (const it of detail) {
      if (it.ytd_current == null) continue;
      const cleanLabel = it.label.replace(/\s*\[\d+\]/g, "").trim();
      const pct = Math.max(1, (Math.abs(it.ytd_current) / max) * 100);
      const delta = fmtPct(it.ytd_current, it.ytd_prior);
      const deltaCls = deltaClass(it.ytd_current, it.ytd_prior, { goodUp: false });
      const negative = it.ytd_current < 0;

      // Check for a known sub-breakdown (Elderly benefits → OAS/GIS/Allowance)
      const subBreakdown = extras?.subBreakdowns?.[cleanLabel.toLowerCase()];

      if (subBreakdown) {
        const subDetail = document.createElement("details");
        subDetail.className = "bar-row has-sub";
        subDetail.innerHTML = `
          <summary>
            <div class="bar-label">${cleanLabel}<span class="chip">▾</span></div>
            <div class="bar-track">
              <div class="bar-fill${negative ? " negative" : ""}"
                   style="width:${pct}%; background:${color}"></div>
            </div>
            <div class="bar-value">${fmtCAD(it.ytd_current)}
              <span class="delta ${deltaCls}">${delta}</span>
            </div>
          </summary>
          <div class="sub-breakdown">${subBreakdown.html}</div>
        `;
        body.appendChild(subDetail);
      } else {
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
        body.appendChild(row);
      }
    }
    container.appendChild(wrapper);
  }
}

// ---------- OAS/GIS/Allowance sub-breakdown ----------

function buildOasSubBreakdown(oasData) {
  if (!oasData || !oasData.latest) return null;
  const L = oasData.latest;
  // Use prior fiscal year for YoY
  const priorIdx = oasData.series.findIndex((s) => s.fiscal_year === L.fiscal_year) - 1;
  const prior = priorIdx >= 0 ? oasData.series[priorIdx] : null;

  // Values are in absolute dollars; convert to millions so fmtCAD works.
  const parts = [
    { name: "OAS pension (net of recovery tax)", value: L.oas_pension, prior: prior?.oas_pension, color: "#fb923c" },
    { name: "Guaranteed Income Supplement", value: L.gis, prior: prior?.gis, color: "#f97316" },
    { name: "Allowance / Allowance for Survivor", value: L.allowance, prior: prior?.allowance, color: "#fdba74" },
  ];
  const maxVal = Math.max(...parts.map((p) => p.value || 0));
  const rows = parts.map((p) => {
    const pct = Math.max(1, ((p.value || 0) / maxVal) * 100);
    const pMil = p.value != null ? p.value / 1_000_000 : null;
    const priorMil = p.prior != null ? p.prior / 1_000_000 : null;
    const delta = fmtPct(pMil, priorMil);
    const cls = deltaClass(pMil, priorMil, { goodUp: false });
    return `
      <div class="sub-row">
        <div class="bar-label">${p.name}</div>
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%; background:${p.color}"></div></div>
        <div class="bar-value">${fmtCAD(pMil)} <span class="delta ${cls}">${delta}</span></div>
      </div>
    `;
  }).join("");

  return {
    html: `
      <div class="sub-note">
        Most recent full fiscal year (${L.fiscal_year}) from ESDC open data.
        The Fiscal Monitor above reports only the combined figure YTD — this
        sub-breakdown is annual and lags by a few months.
      </div>
      ${rows}
    `,
  };
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
    const [indexRes, fmRes, oasRes] = await Promise.all([
      fetch("data/index.json", { cache: "no-store" }),
      fetch("data/fiscal_monitor.json", { cache: "no-store" }),
      fetch("data/oas_breakdown.json", { cache: "no-store" }).catch(() => null),
    ]);
    if (!indexRes.ok) throw new Error("index.json " + indexRes.status);
    if (!fmRes.ok) throw new Error("fiscal_monitor.json " + fmRes.status);

    const index = await indexRes.json();
    const fm = await fmRes.json();
    const oas = oasRes && oasRes.ok ? await oasRes.json() : null;

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
    const oasSub = buildOasSubBreakdown(oas);
    const subBreakdowns = {};
    if (oasSub) subBreakdowns["elderly benefits"] = oasSub;

    renderHierarchicalBreakdown(
      document.getElementById("breakdown-category"),
      fm.spending_by_category?.line_items || [],
      { subBreakdowns }
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

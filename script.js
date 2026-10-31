/**
 * Smart Expense Analyzer — script.js
 * ====================================
 * Vanilla JS, no framework.
 * Sections:
 *   1. Constants & State
 *   2. Helpers (formatting, stats)
 *   3. CSV Parsing & Validation
 *   4. Filter Population
 *   5. Data Filtering
 *   6. KPI Calculation
 *   7. Chart Rendering
 *   8. Top-5 Table
 *   9. AI Insight Generation
 *  10. Budget Tracker
 *  11. UI Helpers (show/hide, messages)
 *  12. Main Render Pipeline
 *  13. Event Listeners & Init
 */

'use strict';

/* =============================================
   1. CONSTANTS & STATE
   ============================================= */

/** Required CSV columns */
const REQUIRED_COLS = ['date', 'description', 'category', 'amount', 'payment_method'];

/** Chart.js colour palette */
const CHART_COLORS = [
  '#0d9488', '#10b981', '#f59e0b', '#6366f1',
  '#f43f5e', '#3b82f6', '#a855f7', '#ec4899',
  '#84cc16', '#06b6d4',
];

/** Application state */
const state = {
  allData:    [],   // full parsed dataset
  filtered:   [],   // currently filtered rows
  charts:     {},   // Chart.js instances keyed by id
  budget:     0,    // monthly budget in IDR
};

/* =============================================
   2. HELPERS
   ============================================= */

/**
 * Format a number as Indonesian Rupiah.
 * @param {number} n
 * @returns {string}
 */
function formatRupiah(n) {
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(n);
}

/**
 * Format a date string (YYYY-MM-DD) to locale-friendly label.
 * @param {string} dateStr
 * @returns {string}
 */
function formatDate(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' });
}

/**
 * Get "YYYY-MM" from a date string for month grouping.
 * @param {string} dateStr
 * @returns {string}
 */
function toYearMonth(dateStr) {
  return dateStr.slice(0, 7);
}

/**
 * Convert "YYYY-MM" to a human-readable month label.
 * @param {string} ym  e.g. "2026-08"
 * @returns {string}
 */
function monthLabel(ym) {
  const [y, m] = ym.split('-');
  const d = new Date(Number(y), Number(m) - 1, 1);
  return d.toLocaleDateString('id-ID', { month: 'long', year: 'numeric' });
}

/**
 * Compute standard deviation of an array of numbers.
 * @param {number[]} arr
 * @returns {number}
 */
function stdDev(arr) {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const variance = arr.reduce((s, v) => s + (v - mean) ** 2, 0) / arr.length;
  return Math.sqrt(variance);
}

/** Sum an array of numbers. */
const sum = arr => arr.reduce((a, b) => a + b, 0);

/* =============================================
   3. CSV PARSING & VALIDATION
   ============================================= */

/**
 * Parse CSV text using PapaParse, validate columns and rows.
 * Returns { data, error } — exactly one of them is non-null.
 * @param {string} csvText
 * @returns {{ data: object[]|null, error: string|null }}
 */
function parseAndValidate(csvText) {
  const result = Papa.parse(csvText, {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
    transformHeader: h => h.trim().toLowerCase().replace(/\s+/g, '_'),
  });

  if (result.errors.length > 0) {
    const msg = result.errors[0].message;
    return { data: null, error: `Gagal membaca CSV: ${msg}` };
  }

  // Validate columns
  const headers = Object.keys(result.data[0] || {});
  const missing = REQUIRED_COLS.filter(c => !headers.includes(c));
  if (missing.length > 0) {
    return {
      data: null,
      error: `Kolom tidak sesuai. Kolom yang dibutuhkan: ${REQUIRED_COLS.join(', ')}. Kolom yang hilang: ${missing.join(', ')}.`,
    };
  }

  // Validate data not empty
  if (result.data.length === 0) {
    return { data: null, error: 'File CSV tidak mengandung data transaksi.' };
  }

  // Normalise & sanitise each row
  const clean = [];
  for (const row of result.data) {
    const amount = parseFloat(String(row.amount).replace(/[^0-9.]/g, ''));
    if (isNaN(amount)) continue; // skip rows with invalid amount
    clean.push({
      date:           String(row.date).trim(),
      description:    String(row.description).trim(),
      category:       String(row.category).trim(),
      amount,
      payment_method: String(row.payment_method).trim(),
    });
  }

  if (clean.length === 0) {
    return { data: null, error: 'Semua baris memiliki data amount yang tidak valid.' };
  }

  // Sort ascending by date
  clean.sort((a, b) => a.date.localeCompare(b.date));

  return { data: clean, error: null };
}

/* =============================================
   4. FILTER POPULATION
   ============================================= */

/**
 * Build <option> list for a <select> element.
 * @param {HTMLSelectElement} selectEl
 * @param {string[]} values  — distinct sorted values
 * @param {string}   allLabel — label for "all" option
 */
function populateSelect(selectEl, values, allLabel) {
  selectEl.innerHTML = `<option value="">${allLabel}</option>`;
  values.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v;
    opt.textContent = v;
    selectEl.appendChild(opt);
  });
}

/**
 * Populate all filter dropdowns from the full dataset.
 * Options are built dynamically from CSV content.
 * @param {object[]} data
 */
function buildFilters(data) {
  // Months
  const months = [...new Set(data.map(r => toYearMonth(r.date)))].sort();
  const monthSel = document.getElementById('filter-month');
  monthSel.innerHTML = '<option value="">Semua Bulan</option>';
  months.forEach(ym => {
    const opt = document.createElement('option');
    opt.value = ym;
    opt.textContent = monthLabel(ym);
    monthSel.appendChild(opt);
  });

  // Categories
  const cats = [...new Set(data.map(r => r.category))].sort();
  populateSelect(document.getElementById('filter-category'), cats, 'Semua Kategori');

  // Payment methods
  const methods = [...new Set(data.map(r => r.payment_method))].sort();
  populateSelect(document.getElementById('filter-payment'), methods, 'Semua Metode');
}

/* =============================================
   5. DATA FILTERING
   ============================================= */

/**
 * Apply the current filter selections to state.allData
 * and store result in state.filtered.
 */
function applyFilters() {
  const month    = document.getElementById('filter-month').value;
  const category = document.getElementById('filter-category').value;
  const payment  = document.getElementById('filter-payment').value;

  state.filtered = state.allData.filter(row => {
    if (month    && toYearMonth(row.date) !== month) return false;
    if (category && row.category          !== category) return false;
    if (payment  && row.payment_method    !== payment)  return false;
    return true;
  });
}

/* =============================================
   6. KPI CALCULATION
   ============================================= */

/**
 * Compute KPI values from filtered data and update the DOM.
 * @param {object[]} data  — filtered rows
 */
function renderKPIs(data) {
  const total = sum(data.map(r => r.amount));

  // Unique dates for avg-per-day
  const dates = [...new Set(data.map(r => r.date))];
  const avgPerDay = dates.length > 0 ? total / dates.length : 0;

  // Top category by total spend
  const catTotals = {};
  data.forEach(r => {
    catTotals[r.category] = (catTotals[r.category] || 0) + r.amount;
  });
  const topCat = Object.entries(catTotals).sort((a, b) => b[1] - a[1])[0];

  document.getElementById('kpi-total').textContent    = formatRupiah(total);
  document.getElementById('kpi-avg').textContent      = formatRupiah(Math.round(avgPerDay));
  document.getElementById('kpi-count').textContent    = data.length + ' transaksi';
  document.getElementById('kpi-top-cat').textContent  = topCat ? topCat[0] : '—';
}

/* =============================================
   7. CHART RENDERING
   ============================================= */

/**
 * Destroy an existing chart instance before re-creating to avoid canvas reuse errors.
 * @param {string} key  — key in state.charts
 */
function destroyChart(key) {
  if (state.charts[key]) {
    state.charts[key].destroy();
    delete state.charts[key];
  }
}

/**
 * Render Spending Trend line chart (daily totals).
 * @param {object[]} data
 */
function renderTrendChart(data) {
  destroyChart('trend');

  // Group by date
  const byDate = {};
  data.forEach(r => {
    byDate[r.date] = (byDate[r.date] || 0) + r.amount;
  });
  const labels = Object.keys(byDate).sort();
  const values = labels.map(d => byDate[d]);

  const ctx = document.getElementById('chart-trend').getContext('2d');
  state.charts['trend'] = new Chart(ctx, {
    type: 'line',
    data: {
      labels: labels.map(d => {
        const dt = new Date(d + 'T00:00:00');
        return dt.toLocaleDateString('id-ID', { day: '2-digit', month: 'short' });
      }),
      datasets: [{
        label: 'Pengeluaran',
        data: values,
        borderColor: '#0d9488',
        backgroundColor: 'rgba(13,148,136,0.08)',
        borderWidth: 2,
        pointRadius: 3,
        pointHoverRadius: 5,
        fill: true,
        tension: 0.35,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => formatRupiah(ctx.parsed.y),
          },
        },
      },
      scales: {
        y: {
          ticks: {
            callback: v => {
              if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'jt';
              if (v >= 1_000)    return (v / 1_000).toFixed(0) + 'rb';
              return v;
            },
            font: { size: 11 },
          },
          grid: { color: '#e2e8f0' },
        },
        x: {
          ticks: { font: { size: 10 }, maxRotation: 45 },
          grid: { display: false },
        },
      },
    },
  });
}

/**
 * Render Category doughnut chart.
 * @param {object[]} data
 */
function renderCategoryChart(data) {
  destroyChart('category');

  // Group by category
  const byCat = {};
  data.forEach(r => {
    byCat[r.category] = (byCat[r.category] || 0) + r.amount;
  });
  const labels = Object.keys(byCat).sort((a, b) => byCat[b] - byCat[a]);
  const values = labels.map(c => byCat[c]);

  const ctx = document.getElementById('chart-category').getContext('2d');
  state.charts['category'] = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data: values,
        backgroundColor: CHART_COLORS.slice(0, labels.length),
        borderWidth: 2,
        borderColor: '#ffffff',
        hoverOffset: 8,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '60%',
      plugins: {
        legend: {
          position: 'bottom',
          labels: { font: { size: 11 }, padding: 12, boxWidth: 12 },
        },
        tooltip: {
          callbacks: {
            label: ctx => {
              const total = sum(values);
              const pct   = total > 0 ? ((ctx.parsed / total) * 100).toFixed(1) : '0';
              return ` ${formatRupiah(ctx.parsed)} (${pct}%)`;
            },
          },
        },
      },
    },
  });
}

/**
 * Render Payment Method bar chart.
 * @param {object[]} data
 */
function renderPaymentChart(data) {
  destroyChart('payment');

  // Group by payment method
  const byPay = {};
  data.forEach(r => {
    byPay[r.payment_method] = (byPay[r.payment_method] || 0) + r.amount;
  });
  const labels = Object.keys(byPay).sort((a, b) => byPay[b] - byPay[a]);
  const values = labels.map(m => byPay[m]);

  const ctx = document.getElementById('chart-payment').getContext('2d');
  state.charts['payment'] = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Total',
        data: values,
        backgroundColor: CHART_COLORS.slice(0, labels.length).map(c => c + 'cc'),
        borderColor: CHART_COLORS.slice(0, labels.length),
        borderWidth: 1.5,
        borderRadius: 6,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => formatRupiah(ctx.parsed.y),
          },
        },
      },
      scales: {
        y: {
          ticks: {
            callback: v => {
              if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + 'jt';
              if (v >= 1_000)    return (v / 1_000).toFixed(0) + 'rb';
              return v;
            },
            font: { size: 11 },
          },
          grid: { color: '#e2e8f0' },
        },
        x: {
          ticks: { font: { size: 11 } },
          grid: { display: false },
        },
      },
    },
  });
}

/* =============================================
   8. TOP-5 TABLE
   ============================================= */

/**
 * Render the Top 5 highest-spend transactions table.
 * @param {object[]} data
 */
function renderTop5(data) {
  const tbody = document.getElementById('top5-body');
  const top5  = [...data].sort((a, b) => b.amount - a.amount).slice(0, 5);

  if (top5.length === 0) {
    tbody.innerHTML = '<tr><td colspan="4" class="py-6 text-center text-slate-400">Tidak ada data</td></tr>';
    return;
  }

  tbody.innerHTML = top5.map((r, i) => `
    <tr>
      <td class="font-mono text-slate-400">${i + 1}</td>
      <td>
        <span class="font-medium">${r.description}</span>
        <span class="block text-xs text-slate-400">${formatDate(r.date)}</span>
      </td>
      <td>
        <span class="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-teal-50 text-teal-700">
          ${r.category}
        </span>
      </td>
      <td>${formatRupiah(r.amount)}</td>
    </tr>
  `).join('');
}

/* =============================================
   9. AI INSIGHT GENERATION
   ============================================= */

/**
 * Generate 4–5 insight sentences from the filtered data
 * and render them in the insight panel.
 * @param {object[]} data   — filtered rows
 * @param {object[]} allData — full dataset (for month comparison)
 */
function renderInsights(data, allData) {
  const list = document.getElementById('insight-list');
  list.innerHTML = '';

  if (data.length === 0) {
    addInsight(list, 'Tidak ada data untuk ditampilkan dengan filter saat ini.', 'default');
    return;
  }

  const totalSpend = sum(data.map(r => r.amount));
  const amounts    = data.map(r => r.amount);

  // (a) Dominant category
  const catTotals = {};
  data.forEach(r => { catTotals[r.category] = (catTotals[r.category] || 0) + r.amount; });
  const sortedCats = Object.entries(catTotals).sort((a, b) => b[1] - a[1]);
  const [topCatName, topCatAmt] = sortedCats[0];
  const topCatPct = totalSpend > 0 ? ((topCatAmt / totalSpend) * 100).toFixed(1) : '0';
  addInsight(list,
    `Kategori <strong>${topCatName}</strong> mendominasi pengeluaran periode ini sebesar ${formatRupiah(topCatAmt)} (${topCatPct}% dari total).`,
    'default'
  );

  // (b) Compare with previous month (only when a single month is selected or data spans months)
  const monthFilter = document.getElementById('filter-month').value;
  if (monthFilter) {
    // Find previous month
    const [y, m] = monthFilter.split('-').map(Number);
    const prevDate = new Date(y, m - 2, 1);
    const prevYM   = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}`;
    const prevData = allData.filter(r => toYearMonth(r.date) === prevYM);

    if (prevData.length > 0) {
      const prevTotal = sum(prevData.map(r => r.amount));
      const diff      = totalSpend - prevTotal;
      const pct       = Math.abs((diff / prevTotal) * 100).toFixed(1);
      const trend     = diff > 0 ? `naik ${pct}%` : `turun ${pct}%`;
      const cls       = diff > 0 ? 'warning' : 'default';
      addInsight(list,
        `Dibandingkan ${monthLabel(prevYM)}, total pengeluaran <strong>${trend}</strong> (dari ${formatRupiah(prevTotal)} menjadi ${formatRupiah(totalSpend)}).`,
        cls
      );
    } else {
      addInsight(list,
        `Tidak ada data bulan sebelumnya (${monthLabel(prevYM)}) untuk dibandingkan.`,
        'default'
      );
    }
  } else {
    // Multi-month: compare last two months present in filtered data
    const monthTotals = {};
    data.forEach(r => {
      const ym = toYearMonth(r.date);
      monthTotals[ym] = (monthTotals[ym] || 0) + r.amount;
    });
    const monthsSorted = Object.keys(monthTotals).sort();
    if (monthsSorted.length >= 2) {
      const lastYM = monthsSorted[monthsSorted.length - 1];
      const prevYM = monthsSorted[monthsSorted.length - 2];
      const lastAmt = monthTotals[lastYM];
      const prevAmt = monthTotals[prevYM];
      const diff    = lastAmt - prevAmt;
      const pct     = Math.abs((diff / prevAmt) * 100).toFixed(1);
      const trend   = diff > 0 ? `naik ${pct}%` : `turun ${pct}%`;
      const cls     = diff > 0 ? 'warning' : 'default';
      addInsight(list,
        `${monthLabel(lastYM)} vs ${monthLabel(prevYM)}: pengeluaran <strong>${trend}</strong> (${formatRupiah(prevAmt)} → ${formatRupiah(lastAmt)}).`,
        cls
      );
    }
  }

  // (c) Anomaly detection: amount > mean + 2 * stddev
  const mean      = totalSpend / amounts.length;
  const sd        = stdDev(amounts);
  const threshold = mean + 2 * sd;
  const anomalies = data.filter(r => r.amount > threshold).sort((a, b) => b.amount - a.amount);

  if (anomalies.length > 0) {
    const top = anomalies[0];
    const allAnomalyNames = anomalies.slice(0, 3).map(r => r.description).join(', ');
    addInsight(list,
      `🔍 Terdeteksi <strong>${anomalies.length} transaksi anomali</strong> (di atas ${formatRupiah(Math.round(threshold))}): ${allAnomalyNames}${anomalies.length > 3 ? ', dll.' : '.'} Terbesar: ${formatRupiah(top.amount)}.`,
      'danger'
    );
  } else {
    addInsight(list,
      'Tidak ada transaksi anomali terdeteksi pada periode ini — pengeluaran relatif konsisten.',
      'default'
    );
  }

  // (d) Saving suggestion for top category
  const suggestAmt = Math.round(topCatAmt * 0.15);
  addInsight(list,
    `💡 Saran: coba kurangi pengeluaran <strong>${topCatName}</strong> sebesar 15% (≈ ${formatRupiah(suggestAmt)}) untuk menghemat lebih banyak bulan ini.`,
    'default'
  );

  // (e) Payment method insight
  const payTotals = {};
  data.forEach(r => { payTotals[r.payment_method] = (payTotals[r.payment_method] || 0) + r.amount; });
  const topPay = Object.entries(payTotals).sort((a, b) => b[1] - a[1])[0];
  if (topPay) {
    const payPct = totalSpend > 0 ? ((topPay[1] / totalSpend) * 100).toFixed(1) : '0';
    addInsight(list,
      `Metode pembayaran paling sering digunakan secara nilai adalah <strong>${topPay[0]}</strong> (${payPct}% dari total pengeluaran).`,
      'default'
    );
  }
}

/**
 * Append one insight bullet to the list.
 * @param {HTMLElement} list
 * @param {string}      html   — inner HTML of the bullet
 * @param {'default'|'warning'|'danger'} type
 */
function addInsight(list, html, type) {
  const li = document.createElement('li');
  if (type === 'warning') li.classList.add('warning');
  if (type === 'danger')  li.classList.add('danger');
  li.innerHTML = html;
  list.appendChild(li);
}

/* =============================================
   10. BUDGET TRACKER
   ============================================= */

/**
 * Evaluate the current filtered total against the set budget
 * and render the progress bar + warning.
 */
function renderBudget() {
  const result = document.getElementById('budget-result');
  if (state.budget <= 0) {
    result.classList.add('hidden');
    return;
  }

  const total = sum(state.filtered.map(r => r.amount));
  const pct   = (total / state.budget) * 100;
  const pctClamped = Math.min(pct, 100); // bar maxes at 100% visually

  const bar      = document.getElementById('budget-bar');
  const warning  = document.getElementById('budget-warning');
  const spentLbl = document.getElementById('budget-spent-label');
  const pctLbl   = document.getElementById('budget-pct-label');

  spentLbl.textContent = `${formatRupiah(total)} dari ${formatRupiah(state.budget)}`;
  pctLbl.textContent   = `${pct.toFixed(1)}%`;

  // Reset classes
  bar.className = 'h-4 rounded-full transition-all duration-500';

  if (pct < 80) {
    bar.style.width = `${pctClamped}%`;
    bar.classList.add('bar-green');
    pctLbl.style.color = '#059669';
    warning.textContent = '✅ Pengeluaran masih dalam batas aman.';
    warning.style.color = '#059669';
  } else if (pct <= 100) {
    bar.style.width = `${pctClamped}%`;
    bar.classList.add('bar-yellow');
    pctLbl.style.color = '#d97706';
    warning.textContent = '⚠️ Pengeluaran mendekati batas budget! Harap berhati-hati.';
    warning.style.color = '#d97706';
  } else {
    bar.style.width = '100%';
    bar.classList.add('bar-red');
    pctLbl.style.color = '#dc2626';
    warning.textContent = `🚨 Budget terlampaui! Kelebihan sebesar ${formatRupiah(total - state.budget)}.`;
    warning.style.color = '#dc2626';
  }

  result.classList.remove('hidden');
}

/* =============================================
   11. UI HELPERS
   ============================================= */

/** Show the message area with a given style and text. */
function showMessage(text, type = 'info') {
  const area = document.getElementById('msg-area');
  area.className = `mt-3 msg-${type}`;
  area.textContent = text;
  area.classList.remove('hidden');
}

/** Hide the message area. */
function hideMessage() {
  document.getElementById('msg-area').classList.add('hidden');
}

/**
 * Toggle all data-dependent sections based on whether data is loaded.
 * @param {boolean} hasData
 */
function toggleSections(hasData) {
  const ids = ['filter-section', 'kpi-section', 'budget-section', 'charts-section', 'insight-section'];
  ids.forEach(id => {
    document.getElementById(id).classList.toggle('hidden', !hasData);
  });
  document.getElementById('empty-state').classList.toggle('hidden', hasData);
  document.getElementById('btn-reset').classList.toggle('hidden', !hasData);
}

/* =============================================
   12. MAIN RENDER PIPELINE
   ============================================= */

/**
 * Full render pass: filter → KPI → charts → top5 → insights → budget.
 * Called whenever filters change or new data is loaded.
 */
function render() {
  applyFilters();
  const d = state.filtered;

  renderKPIs(d);
  renderTrendChart(d);
  renderCategoryChart(d);
  renderPaymentChart(d);
  renderTop5(d);
  renderInsights(d, state.allData);
  renderBudget();
}

/**
 * Load parsed data into state, build filters, and trigger initial render.
 * @param {object[]} data
 */
function loadData(data) {
  state.allData  = data;
  state.filtered = data;

  buildFilters(data);
  toggleSections(true);
  render();
}

/* =============================================
   13. EVENT LISTENERS & INIT
   ============================================= */

document.addEventListener('DOMContentLoaded', () => {

  // --- CSV Upload ---
  document.getElementById('csv-upload').addEventListener('change', function () {
    const file = this.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = e => {
      const { data, error } = parseAndValidate(e.target.result);
      if (error) {
        showMessage(error, 'error');
        return;
      }
      hideMessage();
      showMessage(`✅ Berhasil memuat ${data.length} transaksi dari "${file.name}".`, 'success');
      loadData(data);
    };
    reader.onerror = () => showMessage('Gagal membaca file. Coba lagi.', 'error');
    reader.readAsText(file, 'UTF-8');

    // Reset input so same file can be re-uploaded
    this.value = '';
  });

  // --- Sample Data Button ---
  document.getElementById('btn-sample').addEventListener('click', () => {
    showMessage('Memuat data contoh…', 'info');

    fetch('sample-expenses.csv')
      .then(res => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.text();
      })
      .then(csvText => {
        const { data, error } = parseAndValidate(csvText);
        if (error) {
          showMessage(error, 'error');
          return;
        }
        hideMessage();
        showMessage(`✅ Data contoh berhasil dimuat (${data.length} transaksi).`, 'success');
        loadData(data);
      })
      .catch(() => {
        showMessage(
          '⚠️ Gagal memuat data contoh via fetch. Jika Anda membuka halaman langsung dari file://, ' +
          'gunakan Live Server (VS Code) atau server lokal lainnya. ' +
          'Alternatif: gunakan tombol Upload CSV untuk memilih file sample-expenses.csv secara manual.',
          'error'
        );
      });
  });

  // --- Reset Button ---
  document.getElementById('btn-reset').addEventListener('click', () => {
    state.allData  = [];
    state.filtered = [];
    state.budget   = 0;

    // Destroy charts
    Object.values(state.charts).forEach(c => c.destroy());
    state.charts = {};

    // Reset filters
    document.getElementById('filter-month').innerHTML    = '';
    document.getElementById('filter-category').innerHTML = '';
    document.getElementById('filter-payment').innerHTML  = '';

    // Reset budget input
    document.getElementById('budget-input').value = '';

    toggleSections(false);
    hideMessage();
  });

  // --- Filter Changes — re-render on any filter change ---
  ['filter-month', 'filter-category', 'filter-payment'].forEach(id => {
    document.getElementById(id).addEventListener('change', () => {
      if (state.allData.length > 0) render();
    });
  });

  // --- Budget Apply Button ---
  document.getElementById('btn-set-budget').addEventListener('click', () => {
    const val = parseFloat(document.getElementById('budget-input').value);
    if (isNaN(val) || val < 0) {
      showMessage('Masukkan angka budget yang valid (minimal 0).', 'error');
      return;
    }
    hideMessage();
    state.budget = val;
    renderBudget();
  });

  // Allow pressing Enter on budget input
  document.getElementById('budget-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('btn-set-budget').click();
  });

  // --- Initial state: show empty state, hide data sections ---
  toggleSections(false);
});

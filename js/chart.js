let chartInstance      = null;
let fullHistoryData    = [];
let selectedRange      = "24h";
let viewStart          = 0;
let viewEnd            = 0;
let yPaddingMultiplier = 1.0;

let isDragging        = false;
let startPointerX     = 0;
let startPointerY     = 0;
let dragStartViewStart = 0;
let dragStartViewEnd   = 0;
let dragStartYPadding  = 1.0;

let gesturesAttached = false;

const LOCKED_STRETCH_RANGES = ["6h", "12h", "24h", "7d"];

// ─── 4 Seasons in Exact Order: Spring -> Summer -> Autumn -> Winter ──────────
const SEASONS = [
    {
        name: "Spring", icon: "🌱", color: "#10b981", lightColor: "#047857",
        bg: "bg-emerald-500/15 dark:bg-emerald-950/40",
        border: "border-emerald-600/30 dark:border-emerald-500/30",
        text: "text-emerald-900 dark:text-emerald-400",
    },
    {
        name: "Summer", icon: "☀️", color: "#f59e0b", lightColor: "#b45309",
        bg: "bg-amber-500/15 dark:bg-amber-950/40",
        border: "border-amber-600/30 dark:border-amber-500/30",
        text: "text-amber-900 dark:text-amber-400",
    },
    {
        name: "Autumn", icon: "🍂", color: "#f97316", lightColor: "#c2410c",
        bg: "bg-orange-500/15 dark:bg-orange-950/40",
        border: "border-orange-600/30 dark:border-orange-500/30",
        text: "text-orange-900 dark:text-orange-400",
    },
    {
        name: "Winter", icon: "❄️", color: "#38bdf8", lightColor: "#0284c7",
        bg: "bg-sky-500/15 dark:bg-sky-950/40",
        border: "border-sky-600/30 dark:border-sky-500/30",
        text: "text-sky-900 dark:text-sky-400",
    },
];

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const ONE_DAY_MS    = 24 * 60 * 60 * 1000;

// Anchor: Monday, August 31, 2026 00:00:00 UTC is Summer (season index 1)
const ANCHOR_DATE = Date.UTC(2026, 7, 31, 0, 0, 0); // Month 7 = August
const ANCHOR_SEASON_INDEX = 1; // Summer

function formatPrice(val) {
    if (typeof window.formatDisplayPrice === "function") {
        return window.formatDisplayPrice(val);
    }
    if (val === null || val === undefined || val === "") return "0";
    const num = parseFloat(val);
    if (isNaN(num)) return "0";
    const fixed = num.toFixed(8);
    return fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
}

function getSeasonForDate(date) {
    const targetTime = (date instanceof Date ? date : new Date(date)).getTime();
    
    // Difference in ms from Anchor Monday (Aug 31, 2026 00:00 UTC)
    const diffTime = targetTime - ANCHOR_DATE;
    
    // Number of full 7-day Monday-to-Sunday weeks
    const weekOffset = Math.floor(diffTime / SEVEN_DAYS_MS);
    
    // Exact Monday 00:00 UTC start of this target week
    const weekStart = ANCHOR_DATE + weekOffset * SEVEN_DAYS_MS;
    
    // Day of the week (Day 1 = Monday ... Day 7 = Sunday)
    const dayIndex = Math.floor((targetTime - weekStart) / ONE_DAY_MS);
    const day = Math.min(Math.max(dayIndex + 1, 1), 7);
    
    // Exact modulo 4 season index: Spring(0) -> Summer(1) -> Autumn(2) -> Winter(3)
    const seasonIndex = ((ANCHOR_SEASON_INDEX + (weekOffset % 4)) % 4 + 4) % 4;
    
    return { ...SEASONS[seasonIndex], day };
}

function updateActiveSeasonBadge() {
    const badge = document.getElementById("currentSeasonBadge");
    if (!badge) return;
    const s = getSeasonForDate(new Date());
    badge.className = `text-[9px] font-black px-2 py-0.5 rounded-full border ${s.bg} ${s.border} ${s.text}`;
    badge.innerHTML = `${s.icon} ${s.name} (Day ${s.day}/7)`;
}

function updatePriceChangeBadge(startPrice, currentPrice) {
    const badge = document.getElementById("priceChangeBadge");
    if (!badge) return;

    const diff    = currentPrice - startPrice;
    const percent = startPrice > 0 ? (diff / startPrice) * 100 : 0;
    const rangeLabel = selectedRange.toUpperCase();

    if (diff > 0.00000001) {
        badge.className = "text-[9px] font-black px-2 py-0.5 rounded-full border bg-emerald-500/15 dark:bg-emerald-500/10 text-emerald-900 dark:text-emerald-400 border-emerald-600/30 dark:border-emerald-500/20";
        badge.innerHTML = `+${percent.toFixed(2)}% (${rangeLabel})`;
    } else if (diff < -0.00000001) {
        badge.className = "text-[9px] font-black px-2 py-0.5 rounded-full border bg-rose-500/15 dark:bg-rose-500/10 text-rose-900 dark:text-rose-400 border-rose-600/30 dark:border-rose-500/20";
        badge.innerHTML = `${percent.toFixed(2)}% (${rangeLabel})`;
    } else {
        badge.className = "text-[9px] font-black px-2 py-0.5 rounded-full border bg-[#ede3d1] dark:bg-zinc-800 text-[#544535] dark:text-zinc-400 border-[#cbbeaa] dark:border-zinc-700";
        badge.innerHTML = `0.00% (${rangeLabel})`;
    }
}

function updateCanvasCursor() {
    const canvas = document.getElementById("priceHistoryChart");
    if (!canvas) return;
    if (LOCKED_STRETCH_RANGES.includes(selectedRange)) {
        canvas.style.cursor = "default";
        canvas.classList.remove("cursor-grab", "active:cursor-grabbing");
    } else {
        canvas.style.cursor = "grab";
        canvas.classList.add("cursor-grab");
    }
}

function changeRange(range) {
    selectedRange = range;
    const ranges  = ["6h", "12h", "24h", "7d", "30d", "90d", "all"];
    ranges.forEach(r => {
        const btn = document.getElementById(`range-${r}`);
        if (!btn) return;
        btn.className = r === range
            ? "px-2 py-0.5 rounded-lg transition bg-[#fbf8f2] dark:bg-zinc-800 text-amber-900 dark:text-amber-400 shadow-xs"
            : "px-2 py-0.5 rounded-lg transition text-[#6d5e4d] dark:text-zinc-400 hover:text-black dark:hover:text-white";
    });
    updateCanvasCursor();
    resetSlideView();
    if (window.activeItem) loadItemHistoryGraph(window.activeItem.name);
}

function resetSlideView() {
    viewStart          = 0;
    viewEnd            = Math.max(0, fullHistoryData.length - 1);
    yPaddingMultiplier = 1.0;
    const btn = document.getElementById("resetSlideBtn");
    if (btn) btn.classList.add("hidden");
    if (fullHistoryData.length > 0) renderChart();
}

async function loadItemHistoryGraph(itemName) {
    const spinner = document.getElementById("chartSpinner");
    if (spinner) spinner.classList.remove("hidden");

    let historyData = [];
    try {
        const res = await fetch(`/api/history?item=${encodeURIComponent(itemName)}&range=${selectedRange}`);
        if (res.ok) {
            const raw = await res.json();
            historyData = Array.isArray(raw) ? raw : (raw.rows || []);
        }
    } catch (err) {
        console.warn("[chart] History fetch fallback:", err.message);
    } finally {
        if (spinner) spinner.classList.add("hidden");
    }

    const curPrice = window.activeItem ? parseFloat(window.activeItem.price) : 0;
    const nowTime  = Date.now();

    if (!historyData || historyData.length === 0) {
        historyData = [
            { price: curPrice, recorded_at: new Date(nowTime - 3600000).toISOString() },
            { price: curPrice, recorded_at: new Date(nowTime).toISOString() }
        ];
    } else if (historyData.length === 1) {
        const t0 = new Date(historyData[0].recorded_at || nowTime).getTime();
        historyData = [
            { price: parseFloat(historyData[0].price), recorded_at: new Date(t0 - 3600000).toISOString() },
            historyData[0]
        ];
    }

    fullHistoryData    = historyData;
    viewStart          = 0;
    viewEnd            = fullHistoryData.length - 1;
    yPaddingMultiplier = 1.0;

    updateActiveSeasonBadge();
    updateCanvasCursor();
    renderChart();

    if (!gesturesAttached) {
        attachDirectGestures();
        gesturesAttached = true;
    }
}

function renderChart() {
    const canvas = document.getElementById("priceHistoryChart");
    if (!canvas) return;
    const ctx    = canvas.getContext("2d");
    const isDark = document.documentElement.classList.contains("dark");
    const isMobile = window.innerWidth < 640;

    const clampedStart  = Math.max(0, Math.min(Math.round(viewStart), fullHistoryData.length - 2));
    const clampedEnd    = Math.max(clampedStart + 1, Math.min(Math.round(viewEnd), fullHistoryData.length - 1));
    const visibleData   = fullHistoryData.slice(clampedStart, clampedEnd + 1);

    const labels         = [];
    const itemSeasons    = [];
    const fullDateTips   = [];

    visibleData.forEach(h => {
        const rawDate  = h.recorded_at
            ? h.recorded_at.replace(" ", "T") + (h.recorded_at.includes("Z") ? "" : "Z")
            : new Date().toISOString();
        const d        = new Date(rawDate);
        const validDate = isNaN(d.getTime()) ? new Date() : d;
        const season   = getSeasonForDate(validDate);
        itemSeasons.push(season);

        if (["6h", "12h", "24h"].includes(selectedRange)) {
            labels.push(validDate.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
        } else if (selectedRange === "7d") {
            labels.push(`${season.icon} ${validDate.getDate()}/${validDate.getMonth() + 1} ${validDate.getHours()}:00`);
        } else {
            labels.push(`${season.icon} ${validDate.getDate()}/${validDate.getMonth() + 1}`);
        }

        fullDateTips.push(validDate.toLocaleString([], { dateStyle: "medium", timeStyle: "short" }));
    });

    const prices = visibleData.map(h => parseFloat(h.price));

    if (fullHistoryData.length > 0) {
        const startPrice   = parseFloat(fullHistoryData[0].price);
        const currentPrice = parseFloat(window.activeItem?.price ?? fullHistoryData[fullHistoryData.length - 1].price);
        updatePriceChangeBadge(startPrice, currentPrice);
    }

    const minPrice   = Math.min(...prices);
    const maxPrice   = Math.max(...prices);
    const priceRange = Math.max(maxPrice - minPrice, 0.000001);
    const margin     = priceRange * 0.15 * yPaddingMultiplier;
    const yMin       = Math.max(0, minPrice - margin);
    const yMax       = maxPrice + margin;

    if (chartInstance) chartInstance.destroy();

    const gridColor = isDark ? "rgba(255,255,255,0.05)" : "rgba(100,75,45,0.12)";
    const tickColor = isDark ? "#71717a" : "#45382b";

    const gradient = ctx.createLinearGradient(0, 0, 0, 180);
    gradient.addColorStop(0, isDark ? "rgba(245,158,11,0.22)" : "rgba(217,119,6,0.25)");
    gradient.addColorStop(1, "rgba(245,158,11,0.0)");

    chartInstance = new Chart(ctx, {
        type: "line",
        data: {
            labels,
            datasets: [{
                label:          "Price (SFL)",
                data:           prices,
                borderColor:    isDark ? "#f59e0b" : "#b45309",
                segment: {
                    borderColor: ctxSeg => {
                        const s = itemSeasons[ctxSeg.p1DataIndex];
                        return isDark ? (s?.color || "#f59e0b") : (s?.lightColor || "#b45309");
                    },
                },
                borderWidth:        isMobile ? 2 : 2.5,
                backgroundColor:    gradient,
                fill:               true,
                tension:            0.35,
                pointBackgroundColor: itemSeasons.map(s => isDark ? s.color : s.lightColor),
                pointBorderColor:   isDark ? "#000000" : "#fbf8f2",
                pointBorderWidth:   1.5,
                pointRadius:        visibleData.length > 25 ? 0 : 3.5,
                pointHoverRadius:   6,
                pointHoverBorderWidth: 2,
            }],
        },
        options: {
            responsive:        true,
            maintainAspectRatio: false,
            animation:         false,
            interaction:       { mode: "index", intersect: false },
            plugins: {
                legend:  { display: false },
                tooltip: {
                    backgroundColor: isDark ? "#18181b" : "#221911",
                    titleColor:      "#faf7f2",
                    bodyColor:       "#fbbf24",
                    borderColor:     isDark ? "#27272a" : "#cbbeaa",
                    borderWidth:     1,
                    padding:         8,
                    cornerRadius:    12,
                    displayColors:   false,
                    callbacks: {
                        title: items => {
                            const i   = items[0].dataIndex;
                            const s   = itemSeasons[i];
                            return `${s?.icon || "🌱"} ${s?.name || "Summer"} Season (Day ${s?.day || 1}/7)\n📅 ${fullDateTips[i]}`;
                        },
                        label: ctx => `Price: ${formatPrice(ctx.parsed.y)} SFL`,
                    },
                },
            },
            scales: {
                x: {
                    grid:   { color: gridColor, borderDash: [2, 2] },
                    ticks:  { font: { size: 9, weight: "700" }, color: tickColor, maxTicksLimit: 5, maxRotation: 0 },
                    border: { display: false },
                },
                y: {
                    min:    yMin,
                    max:    yMax,
                    grid:   { color: gridColor, borderDash: [2, 2] },
                    ticks:  { font: { size: 9, weight: "700" }, color: tickColor, maxTicksLimit: 4, callback: val => formatPrice(val) },
                    border: { display: false },
                },
            },
        },
    });
}

function attachDirectGestures() {
    const canvas = document.getElementById("priceHistoryChart");
    if (!canvas) return;

    canvas.addEventListener("pointerdown", e => {
        if (LOCKED_STRETCH_RANGES.includes(selectedRange)) return;
        if (fullHistoryData.length < 2) return;
        isDragging          = true;
        canvas.setPointerCapture(e.pointerId);
        startPointerX       = e.clientX;
        startPointerY       = e.clientY;
        dragStartViewStart  = viewStart;
        dragStartViewEnd    = viewEnd;
        dragStartYPadding   = yPaddingMultiplier;
    });

    canvas.addEventListener("pointermove", e => {
        if (!isDragging || LOCKED_STRETCH_RANGES.includes(selectedRange) || fullHistoryData.length < 2) return;
        const deltaX       = e.clientX - startPointerX;
        const deltaY       = e.clientY - startPointerY;
        const visibleSpan  = Math.max(1, dragStartViewEnd - dragStartViewStart);
        const pxPerItem    = (canvas.clientWidth / visibleSpan) / 2.8;
        const itemsShifted = deltaX / pxPerItem;

        if (Math.abs(itemsShifted) >= 0.3) {
            viewStart = Math.max(0, dragStartViewStart - itemsShifted);
            viewEnd   = Math.min(fullHistoryData.length - 1, dragStartViewEnd - itemsShifted);
            document.getElementById("resetSlideBtn")?.classList.remove("hidden");
        }
        if (Math.abs(deltaY) > 2) {
            yPaddingMultiplier = Math.max(0.1, Math.min(4.0, dragStartYPadding + deltaY * 0.02));
            document.getElementById("resetSlideBtn")?.classList.remove("hidden");
        }
        renderChart();
    });

    const stopDrag = e => {
        if (!isDragging) return;
        isDragging = false;
        try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
    };
    canvas.addEventListener("pointerup",     stopDrag);
    canvas.addEventListener("pointercancel", stopDrag);
}

window.addEventListener("resize", () => {
    if (fullHistoryData.length > 0) renderChart();
});

document.addEventListener("DOMContentLoaded", () => {
    updateActiveSeasonBadge();
});

window.fullHistoryData        = fullHistoryData;
window.changeRange            = changeRange;
window.resetSlideView         = resetSlideView;
window.loadItemHistoryGraph   = loadItemHistoryGraph;
window.renderChart            = renderChart;
window.getSeasonForDate       = getSeasonForDate;
window.updateActiveSeasonBadge = updateActiveSeasonBadge;

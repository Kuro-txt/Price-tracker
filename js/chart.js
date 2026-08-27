let chartInstance = null;
let fullHistoryData = [];
let selectedRange = "24h";

let viewStart = 0;
let viewEnd = 0;
let yPaddingMultiplier = 1.0;

let isDragging = false;
let startPointerX = 0;
let startPointerY = 0;
let dragStartViewStart = 0;
let dragStartViewEnd = 0;
let dragStartYPadding = 1.0;
let initialPinchDistance = null;

const SEASONS = [
    { name: 'Spring', icon: '🌱', color: '#10b981' },
    { name: 'Summer', icon: '☀️', color: '#f59e0b' },
    { name: 'Autumn', icon: '🍂', color: '#f97316' },
    { name: 'Winter', icon: '❄️', color: '#38bdf8' }
];

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

function formatPrice(val) {
    if (typeof window.formatDisplayPrice === 'function') {
        return window.formatDisplayPrice(val);
    }
    const num = parseFloat(val);
    if (isNaN(num)) return "0.00";
    if (num < 0.001) return num.toFixed(6).replace(/\.?0+$/, "");
    if (num < 1) return num.toFixed(4).replace(/\.?0+$/, "");
    return num.toFixed(2);
}

function getSeasonForDate(date) {
    const now = new Date();
    const nowDay = now.getUTCDay();
    const diffToMon = (nowDay + 6) % 7;
    const currentWeekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diffToMon)).getTime();

    const targetTime = date.getTime();
    const diffTime = targetTime - currentWeekStart;
    
    const weekOffset = Math.floor(diffTime / SEVEN_DAYS_MS);
    const seasonIndex = ((weekOffset % 4) + 4) % 4;
    const dayInSeason = (Math.floor((targetTime - (currentWeekStart + weekOffset * SEVEN_DAYS_MS)) / (24 * 60 * 60 * 1000)) + 1);
    
    return {
        ...SEASONS[seasonIndex],
        day: Math.min(Math.max(dayInSeason, 1), 7)
    };
}

function updateActiveSeasonBadge() {
    const badge = document.getElementById('currentSeasonBadge');
    if (!badge) return;
    const currentSeason = getSeasonForDate(new Date());
    badge.innerText = `${currentSeason.icon} ${currentSeason.name} (Day ${currentSeason.day}/7)`;
}

function updatePriceChangeBadge(startPrice, currentPrice) {
    const badge = document.getElementById('priceChangeBadge');
    if (!badge) return;

    const diff = currentPrice - startPrice;
    const percent = startPrice > 0 ? (diff / startPrice) * 100 : 0;
    const rangeLabel = selectedRange.toUpperCase();

    if (diff > 0.000001) {
        badge.className = "text-[10px] font-black px-2 py-0.5 rounded-full border bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20";
        badge.innerHTML = `+${percent.toFixed(2)}% (${rangeLabel})`;
    } else if (diff < -0.000001) {
        badge.className = "text-[10px] font-black px-2 py-0.5 rounded-full border bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20";
        badge.innerHTML = `${percent.toFixed(2)}% (${rangeLabel})`;
    } else {
        badge.className = "text-[10px] font-black px-2 py-0.5 rounded-full border bg-zinc-500/10 text-zinc-500 border-zinc-500/20";
        badge.innerHTML = `0.00% (${rangeLabel})`;
    }
}

function changeRange(range) {
    selectedRange = range;
    const ranges = ['6h', '12h', '24h', '7d', '30d', '90d', 'all'];
    ranges.forEach(r => {
        const btn = document.getElementById(`range-${r}`);
        if (!btn) return;
        if (r === range) {
            btn.className = "px-2 py-0.5 rounded-lg transition bg-white dark:bg-zinc-800 text-amber-600 dark:text-amber-400 shadow-xs";
        } else {
            btn.className = "px-2 py-0.5 rounded-lg transition text-zinc-500 hover:text-black dark:hover:text-white";
        }
    });

    resetSlideView();
    if (window.activeItem) {
        loadItemHistoryGraph(window.activeItem.name);
    }
}

function resetSlideView() {
    viewStart = 0;
    viewEnd = Math.max(0, fullHistoryData.length - 1);
    yPaddingMultiplier = 1.0;
    const btn = document.getElementById('resetSlideBtn');
    if (btn) btn.classList.add('hidden');
    if (fullHistoryData.length > 0) renderChart();
}

async function loadItemHistoryGraph(itemName) {
    const spinner = document.getElementById('chartSpinner');
    if (spinner) spinner.classList.remove('hidden');

    let historyData = [];
    try {
        const res = await fetch(`/api/history?item=${encodeURIComponent(itemName)}&range=${selectedRange}`);
        if (res.ok) {
            const raw = await res.json();
            historyData = Array.isArray(raw) ? raw : (raw.rows || []);
        }
    } catch (err) {
        console.error("Failed to load history:", err);
    } finally {
        if (spinner) spinner.classList.add('hidden');
    }

    if (!historyData || historyData.length === 0) {
        historyData = [{
            price: window.activeItem ? window.activeItem.price : 0,
            recorded_at: new Date().toISOString()
        }];
    }

    fullHistoryData = historyData;
    viewStart = 0;
    viewEnd = fullHistoryData.length - 1;
    yPaddingMultiplier = 1.0;

    updateActiveSeasonBadge();
    renderChart();
    attachDirectGestures();
}

function renderChart() {
    const canvas = document.getElementById('priceHistoryChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const clampedStart = Math.max(0, Math.min(Math.round(viewStart), fullHistoryData.length - 2));
    const clampedEnd = Math.max(clampedStart + 1, Math.min(Math.round(viewEnd), fullHistoryData.length - 1));
    const visibleData = fullHistoryData.slice(clampedStart, clampedEnd + 1);

    const labels = [];
    const itemSeasons = [];
    const fullDateTooltips = [];

    visibleData.forEach(h => {
        const rawDate = h.recorded_at ? h.recorded_at.replace(" ", "T") + (h.recorded_at.includes("Z") ? "" : "Z") : new Date().toISOString();
        const d = new Date(rawDate);
        const validDate = isNaN(d.getTime()) ? new Date() : d;

        itemSeasons.push(getSeasonForDate(validDate));

        if (['6h', '12h', '24h'].includes(selectedRange)) {
            labels.push(validDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        } else if (selectedRange === '7d') {
            labels.push(`${validDate.getDate()}/${validDate.getMonth()+1} ${validDate.getHours()}:00`);
        } else {
            labels.push(`${validDate.getDate()}/${validDate.getMonth()+1}`);
        }

        fullDateTooltips.push(validDate.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }));
    });

    const prices = visibleData.map(h => parseFloat(h.price));

    if (fullHistoryData.length > 0) {
        const startPrice = parseFloat(fullHistoryData[0].price);
        const currentPrice = parseFloat(window.activeItem?.price ?? fullHistoryData[fullHistoryData.length - 1].price);
        updatePriceChangeBadge(startPrice, currentPrice);
    }

    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const priceRange = Math.max(maxPrice - minPrice, 0.0001);

    const margin = priceRange * 0.15 * yPaddingMultiplier;
    const yMin = Math.max(0, minPrice - margin);
    const yMax = maxPrice + margin;

    if (chartInstance) chartInstance.destroy();

    const isDark = document.documentElement.classList.contains('dark');
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.04)' : 'rgba(0, 0, 0, 0.04)';
    const tickColor = isDark ? '#71717a' : '#a1a1aa';

    const gradient = ctx.createLinearGradient(0, 0, 0, 180);
    gradient.addColorStop(0, 'rgba(245, 158, 11, 0.18)');
    gradient.addColorStop(1, 'rgba(245, 158, 11, 0.0)');

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                data: prices,
                borderColor: '#f59e0b',
                borderWidth: 2,
                backgroundColor: gradient,
                fill: true,
                tension: 0.35,
                pointRadius: 0,
                pointHoverRadius: 5,
                pointHoverBackgroundColor: '#f59e0b',
                pointHoverBorderColor: isDark ? '#000' : '#fff',
                pointHoverBorderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: isDark ? '#18181b' : '#ffffff',
                    titleColor: isDark ? '#f4f4f5' : '#18181b',
                    bodyColor: '#f59e0b',
                    borderColor: isDark ? '#27272a' : '#e4e4e7',
                    borderWidth: 1,
                    padding: 8,
                    cornerRadius: 12,
                    displayColors: false,
                    callbacks: {
                        title: (items) => fullDateTooltips[items[0].dataIndex],
                        label: (ctxLabel) => `Price: ${formatPrice(ctxLabel.parsed.y)} SFL`
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: gridColor, borderDash: [2, 2] },
                    ticks: { font: { size: 9, weight: '600' }, color: tickColor, maxTicksLimit: 5 },
                    border: { display: false }
                },
                y: {
                    min: yMin,
                    max: yMax,
                    grid: { color: gridColor, borderDash: [2, 2] },
                    ticks: { font: { size: 9, weight: '600' }, color: tickColor, maxTicksLimit: 4, callback: (val) => formatPrice(val) },
                    border: { display: false }
                }
            }
        }
    });
}

function attachDirectGestures() {
    const canvas = document.getElementById('priceHistoryChart');
    if (!canvas || canvas.dataset.gesturesAttached) return;
    canvas.dataset.gesturesAttached = "true";

    canvas.addEventListener('pointerdown', (e) => {
        if (fullHistoryData.length < 2) return;
        isDragging = true;
        canvas.setPointerCapture(e.pointerId);
        startPointerX = e.clientX;
        startPointerY = e.clientY;
        dragStartViewStart = viewStart;
        dragStartViewEnd = viewEnd;
        dragStartYPadding = yPaddingMultiplier;
    });

    canvas.addEventListener('pointermove', (e) => {
        if (!isDragging || fullHistoryData.length < 2) return;
        const deltaX = e.clientX - startPointerX;
        const deltaY = e.clientY - startPointerY;

        const visibleSpan = Math.max(1, dragStartViewEnd - dragStartViewStart);
        const pixelsPerItem = (canvas.clientWidth / visibleSpan) / 2.8;
        const itemsShifted = deltaX / pixelsPerItem;

        if (Math.abs(itemsShifted) >= 0.3) {
            let newStart = Math.max(0, dragStartViewStart - itemsShifted);
            let newEnd = Math.min(fullHistoryData.length - 1, dragStartViewEnd - itemsShifted);
            viewStart = newStart;
            viewEnd = newEnd;
            const btn = document.getElementById('resetSlideBtn');
            if (btn) btn.classList.remove('hidden');
        }

        if (Math.abs(deltaY) > 2) {
            yPaddingMultiplier = Math.max(0.1, Math.min(4.0, dragStartYPadding + (deltaY * 0.02)));
            const btn = document.getElementById('resetSlideBtn');
            if (btn) btn.classList.remove('hidden');
        }

        renderChart();
    });

    const stopDragging = (e) => {
        if (isDragging) {
            isDragging = false;
            try { canvas.releasePointerCapture(e.pointerId); } catch (_) {}
        }
    };
    canvas.addEventListener('pointerup', stopDragging);
    canvas.addEventListener('pointercancel', stopDragging);
}

window.addEventListener('resize', () => {
    if (fullHistoryData.length > 0) renderChart();
});

// Globals
window.fullHistoryData = fullHistoryData;
window.changeRange = changeRange;
window.resetSlideView = resetSlideView;
window.loadItemHistoryGraph = loadItemHistoryGraph;
window.renderChart = renderChart;

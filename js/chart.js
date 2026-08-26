let chartInstance = null;
let lastHistoryData = [];
let selectedRange = "24h";

// SFL 4-Season Cycle (7 Days each = 28-day loop)
const SEASONS = [
    { name: 'Spring', icon: '🌱', color: '#10b981', textColor: 'text-emerald-500', bg: 'bg-emerald-100 dark:bg-emerald-950/80', border: 'border-emerald-200 dark:border-emerald-800/60' },
    { name: 'Summer', icon: '☀️', color: '#f59e0b', textColor: 'text-amber-500', bg: 'bg-amber-100 dark:bg-amber-950/80', border: 'border-amber-200 dark:border-amber-800/60' },
    { name: 'Autumn', icon: '🍂', color: '#ea580c', textColor: 'text-orange-500', bg: 'bg-orange-100 dark:bg-orange-950/80', border: 'border-orange-200 dark:border-orange-800/60' },
    { name: 'Winter', icon: '❄️', color: '#38bdf8', textColor: 'text-sky-500', bg: 'bg-sky-100 dark:bg-sky-950/80', border: 'border-sky-200 dark:border-sky-800/60' }
];

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

// Deterministic season calculator anchored to current week being Spring (Index 0)
function getSeasonForDate(date) {
    const now = new Date();
    // Align with Monday 00:00 UTC weekly reset
    const nowDay = now.getUTCDay();
    const diffToMon = (nowDay + 6) % 7;
    const currentWeekStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - diffToMon)).getTime();

    const targetTime = date.getTime();
    const diffTime = targetTime - currentWeekStart;
    
    const weekOffset = Math.floor(diffTime / SEVEN_DAYS_MS);
    const seasonIndex = ((weekOffset % 4) + 4) % 4;
    
    // Calculate which day of the 7-day season (Day 1 to 7)
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
    badge.className = `inline-flex items-center gap-1 text-[10px] sm:text-xs font-bold px-2 sm:px-2.5 py-0.5 rounded-full border ${currentSeason.bg} ${currentSeason.border} ${currentSeason.textColor}`;
    badge.innerHTML = `<span>${currentSeason.icon}</span> <span>${currentSeason.name} (Day ${currentSeason.day}/7)</span>`;
}

function changeRange(range) {
    selectedRange = range;
    const ranges = ['24h', '7d', '30d', '90d'];
    ranges.forEach(r => {
        const btn = document.getElementById(`range-${r}`);
        if (!btn) return;
        if (r === range) {
            btn.className = "flex-1 sm:flex-initial px-3 py-1 rounded-lg transition bg-white dark:bg-slate-800 text-amber-600 dark:text-amber-400 shadow-sm text-center";
        } else {
            btn.className = "flex-1 sm:flex-initial px-3 py-1 rounded-lg transition text-stone-500 dark:text-slate-400 hover:text-stone-900 dark:hover:text-white text-center";
        }
    });

    if (window.activeItem) {
        loadItemHistoryGraph(window.activeItem.name);
    }
}

async function loadItemHistoryGraph(itemName) {
    const spinner = document.getElementById('chartSpinner');
    const countLabel = document.getElementById('graphDataCount');
    if (spinner) spinner.classList.remove('hidden');

    let historyData = [];
    try {
        const res = await fetch(`/api/history?item=${encodeURIComponent(itemName)}&range=${selectedRange}`);
        if (res.ok) {
            historyData = await res.json();
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
        if (countLabel) countLabel.innerText = "1 point recorded";
    } else {
        if (countLabel) countLabel.innerText = `${historyData.length} records (${selectedRange.toUpperCase()})`;
    }

    lastHistoryData = historyData;
    updateActiveSeasonBadge();
    renderChart(historyData);
}

function renderChart(historyData) {
    const canvas = document.getElementById('priceHistoryChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const isMobile = window.innerWidth < 640;

    const labels = [];
    const itemSeasons = [];
    const fullDateTooltips = [];

    historyData.forEach(h => {
        const rawDate = h.recorded_at ? h.recorded_at.replace(" ", "T") + (h.recorded_at.includes("Z") ? "" : "Z") : new Date().toISOString();
        const d = new Date(rawDate);
        const validDate = isNaN(d.getTime()) ? new Date() : d;

        const season = getSeasonForDate(validDate);
        itemSeasons.push(season);

        if (selectedRange === '24h') {
            labels.push(validDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
        } else if (selectedRange === '7d') {
            labels.push(isMobile 
                ? `${season.icon} ${validDate.getDate()}/${validDate.getMonth()+1}` 
                : `${season.icon} ${validDate.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${validDate.getHours()}:00`);
        } else {
            labels.push(`${season.icon} ${validDate.getDate()}/${validDate.getMonth()+1}`);
        }

        fullDateTooltips.push(validDate.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }));
    });

    const prices = historyData.map(h => parseFloat(h.price));

    if (chartInstance) {
        chartInstance.destroy();
    }

    const isDark = document.documentElement.classList.contains('dark');
    const gridColor = isDark ? '#1e293b' : '#f5f5f4';
    const tickColor = isDark ? '#94a3b8' : '#a8a29e';
    const tooltipBg = isDark ? '#090d16' : '#1c1917';

    const gradient = ctx.createLinearGradient(0, 0, 0, isMobile ? 180 : 240);
    gradient.addColorStop(0, 'rgba(245, 158, 11, 0.25)');
    gradient.addColorStop(1, 'rgba(245, 158, 11, 0.0)');

    const pointRadius = (selectedRange === '30d' || selectedRange === '90d' || historyData.length > 30) ? 0 : (isMobile ? 2.5 : 3.5);

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Price (SFL)',
                data: prices,
                borderColor: '#f59e0b',
                borderWidth: isMobile ? 2 : 2.5,
                backgroundColor: gradient,
                fill: true,
                tension: 0.35,
                pointBackgroundColor: isDark ? '#0f172a' : '#ffffff',
                pointBorderColor: '#f59e0b',
                pointBorderWidth: 1.5,
                pointRadius: pointRadius,
                pointHoverRadius: 5,
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: tooltipBg,
                    titleColor: '#fafaf9',
                    bodyColor: '#f59e0b',
                    padding: 10,
                    displayColors: false,
                    callbacks: {
                        title: (items) => {
                            const index = items[0].dataIndex;
                            const season = itemSeasons[index];
                            const timeStr = fullDateTooltips[index];
                            return `${season.icon} ${season.name} Season (Day ${season.day}/7)\n📅 ${timeStr}`;
                        },
                        label: (ctx) => ` Price: ${window.formatDisplayPrice(ctx.parsed.y)} SFL`
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: gridColor },
                    ticks: { 
                        font: { family: 'Plus Jakarta Sans', size: isMobile ? 9 : 10 }, 
                        color: tickColor, 
                        maxTicksLimit: isMobile ? 5 : 8 
                    }
                },
                y: {
                    grid: { color: gridColor },
                    ticks: { 
                        font: { family: 'Plus Jakarta Sans', size: isMobile ? 9 : 10 }, 
                        color: tickColor, 
                        maxTicksLimit: 5,
                        callback: (val) => window.formatDisplayPrice(val) 
                    }
                }
            }
        }
    });
}

window.addEventListener('resize', () => {
    if (lastHistoryData.length > 0) {
        renderChart(lastHistoryData);
    }
});

// Expose globals
window.changeRange = changeRange;
window.loadItemHistoryGraph = loadItemHistoryGraph;
window.renderChart = renderChart;
window.getSeasonForDate = getSeasonForDate;
window.updateActiveSeasonBadge = updateActiveSeasonBadge;

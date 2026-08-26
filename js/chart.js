let chartInstance = null;
let lastHistoryData = [];
let selectedRange = "24h";

function changeRange(range) {
    selectedRange = range;
    const ranges = ['24h', '7d', '30d', '90d'];
    ranges.forEach(r => {
        const btn = document.getElementById(`range-${r}`);
        if (!btn) return;
        if (r === range) {
            btn.className = "px-2.5 py-1 rounded-lg transition bg-white dark:bg-slate-800 text-amber-600 dark:text-amber-400 shadow-sm";
        } else {
            btn.className = "px-2.5 py-1 rounded-lg transition text-stone-500 dark:text-slate-400 hover:text-stone-900 dark:hover:text-white";
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
        if (countLabel) countLabel.innerText = "1 data point recorded";
    } else {
        if (countLabel) countLabel.innerText = `Showing ${historyData.length} snapshots for ${selectedRange.toUpperCase()}`;
    }

    lastHistoryData = historyData;
    renderChart(historyData);
}

function renderChart(historyData) {
    const canvas = document.getElementById('priceHistoryChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const labels = historyData.map(h => {
        const rawDate = h.recorded_at ? h.recorded_at.replace(" ", "T") + (h.recorded_at.includes("Z") ? "" : "Z") : new Date().toISOString();
        const d = new Date(rawDate);
        if (isNaN(d.getTime())) return "Now";

        if (selectedRange === '24h') {
            return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        } else if (selectedRange === '7d') {
            return `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
        } else {
            return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
        }
    });

    const fullDateTooltips = historyData.map(h => {
        const rawDate = h.recorded_at ? h.recorded_at.replace(" ", "T") + (h.recorded_at.includes("Z") ? "" : "Z") : new Date().toISOString();
        const d = new Date(rawDate);
        return isNaN(d.getTime()) ? "Current" : d.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    });

    const prices = historyData.map(h => parseFloat(h.price));

    if (chartInstance) {
        chartInstance.destroy();
    }

    const isDark = document.documentElement.classList.contains('dark');
    const gridColor = isDark ? '#1e293b' : '#f5f5f4';
    const tickColor = isDark ? '#94a3b8' : '#a8a29e';
    const tooltipBg = isDark ? '#090d16' : '#292524';

    const gradient = ctx.createLinearGradient(0, 0, 0, 240);
    gradient.addColorStop(0, 'rgba(245, 158, 11, 0.25)');
    gradient.addColorStop(1, 'rgba(245, 158, 11, 0.0)');

    const pointRadius = (selectedRange === '30d' || selectedRange === '90d' || historyData.length > 50) ? 0 : 3.5;

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Price (SFL)',
                data: prices,
                borderColor: '#f59e0b',
                borderWidth: 2.5,
                backgroundColor: gradient,
                fill: true,
                tension: 0.35,
                pointBackgroundColor: isDark ? '#0f172a' : '#ffffff',
                pointBorderColor: '#f59e0b',
                pointBorderWidth: 2,
                pointRadius: pointRadius,
                pointHoverRadius: 6,
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
                        title: (items) => fullDateTooltips[items[0].dataIndex] || items[0].label,
                        label: (ctx) => ` Price: ${window.formatDisplayPrice(ctx.parsed.y)} SFL`
                    }
                }
            },
            scales: {
                x: {
                    grid: { color: gridColor },
                    ticks: { font: { family: 'Plus Jakarta Sans', size: 10 }, color: tickColor, maxTicksLimit: 8 }
                },
                y: {
                    grid: { color: gridColor },
                    ticks: { font: { family: 'Plus Jakarta Sans', size: 10 }, color: tickColor, callback: (val) => window.formatDisplayPrice(val) }
                }
            }
        }
    });
}

// Expose globals
window.changeRange = changeRange;
window.loadItemHistoryGraph = loadItemHistoryGraph;
window.renderChart = renderChart;

let chartInstance = null;
let fullHistoryData = [];
let selectedRange = "24h";

// Sliding & Scaling Window State
let viewStart = 0;
let viewEnd = 0;
let yPaddingMultiplier = 1.0;

// Pointer & Drag Gesture State
let isDragging = false;
let startPointerX = 0;
let startPointerY = 0;
let dragStartViewStart = 0;
let dragStartViewEnd = 0;
let dragStartYPadding = 1.0;
let initialPinchDistance = null;

// SFL 4-Season Cycle (7 Days each = 28-day loop)
const SEASONS = [
    { name: 'Spring', icon: '🌱', color: '#10b981', textColor: 'text-emerald-500', bg: 'bg-emerald-100 dark:bg-emerald-950/80', border: 'border-emerald-200 dark:border-emerald-800/60' },
    { name: 'Summer', icon: '☀️', color: '#f59e0b', textColor: 'text-amber-500', bg: 'bg-amber-100 dark:bg-amber-950/80', border: 'border-amber-200 dark:border-amber-800/60' },
    { name: 'Autumn', icon: '🍂', color: '#ea580c', textColor: 'text-orange-500', bg: 'bg-orange-100 dark:bg-orange-950/80', border: 'border-orange-200 dark:border-orange-800/60' },
    { name: 'Winter', icon: '❄️', color: '#38bdf8', textColor: 'text-sky-500', bg: 'bg-sky-100 dark:bg-sky-950/80', border: 'border-sky-200 dark:border-sky-800/60' }
];

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

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
    badge.className = `inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full border ${currentSeason.bg} ${currentSeason.border} ${currentSeason.textColor}`;
    badge.innerHTML = `<span>${currentSeason.icon}</span> <span>${currentSeason.name} (Day ${currentSeason.day}/7)</span>`;
}

function changeRange(range) {
    selectedRange = range;
    const ranges = ['24h', '7d', '30d', '90d'];
    ranges.forEach(r => {
        const btn = document.getElementById(`range-${r}`);
        if (!btn) return;
        if (r === range) {
            btn.className = "px-2.5 py-0.5 rounded-md transition bg-white dark:bg-slate-800 text-amber-600 dark:text-amber-400 shadow-2xs";
        } else {
            btn.className = "px-2.5 py-0.5 rounded-md transition text-stone-500 dark:text-slate-400 hover:text-stone-900 dark:hover:text-white";
        }
    });

    resetSlideView();

    if (window.activeItem) {
        loadItemHistoryGraph(window.activeItem.name);
    }
}

function showResetButton() {
    const btn = document.getElementById('resetSlideBtn');
    if (btn) btn.classList.remove('hidden');
}

function hideResetButton() {
    const btn = document.getElementById('resetSlideBtn');
    if (btn) btn.classList.add('hidden');
}

function resetSlideView() {
    viewStart = 0;
    viewEnd = Math.max(0, fullHistoryData.length - 1);
    yPaddingMultiplier = 1.0;
    hideResetButton();
    if (fullHistoryData.length > 0) {
        renderChart();
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

    fullHistoryData = historyData;
    viewStart = 0;
    viewEnd = fullHistoryData.length - 1;
    yPaddingMultiplier = 1.0;

    updateActiveSeasonBadge();
    hideResetButton();
    renderChart();
    attachDirectGestures();
}

function renderChart() {
    const canvas = document.getElementById('priceHistoryChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const isMobile = window.innerWidth < 640;

    // Active Visible Window
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

    const prices = visibleData.map(h => parseFloat(h.price));

    // Responsive Y-Axis Scale Bounds
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const priceRange = Math.max(maxPrice - minPrice, 0.0001);

    const margin = priceRange * 0.18 * yPaddingMultiplier;
    const yMin = Math.max(0, minPrice - margin);
    const yMax = maxPrice + margin;

    if (chartInstance) {
        chartInstance.destroy();
    }

    const isDark = document.documentElement.classList.contains('dark');
    const gridColor = isDark ? '#1e293b' : '#f5f5f4';
    const tickColor = isDark ? '#94a3b8' : '#a8a29e';
    const tooltipBg = isDark ? '#090d16' : '#1c1917';

    const pointColors = itemSeasons.map(s => s.color);

    const gradient = ctx.createLinearGradient(0, 0, 0, isMobile ? 180 : 240);
    gradient.addColorStop(0, 'rgba(245, 158, 11, 0.20)');
    gradient.addColorStop(1, 'rgba(245, 158, 11, 0.0)');

    const pointRadius = (visibleData.length > 30) ? 0 : (isMobile ? 3 : 4);

    chartInstance = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Price (SFL)',
                data: prices,
                borderColor: '#f59e0b',
                segment: {
                    borderColor: ctxSeg => {
                        const pIndex = ctxSeg.p1DataIndex;
                        return itemSeasons[pIndex]?.color || '#f59e0b';
                    }
                },
                borderWidth: isMobile ? 2 : 2.5,
                backgroundColor: gradient,
                fill: true,
                tension: 0.35,
                pointBackgroundColor: pointColors,
                pointBorderColor: isDark ? '#0f172a' : '#ffffff',
                pointBorderWidth: 1.5,
                pointRadius: pointRadius,
                pointHoverRadius: 6,
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
                            return `${season?.icon || '🌱'} ${season?.name || 'Spring'} Season (Day ${season?.day || 1}/7)\n📅 ${timeStr}`;
                        },
                        label: (ctxLabel) => ` Price: ${window.formatDisplayPrice(ctxLabel.parsed.y)} SFL`
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
                    min: yMin,
                    max: yMax,
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

// Attach High-Velocity Gesture Handlers
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

        // Boosted Horizontal Velocity (Slide Time)
        const visibleSpan = Math.max(1, dragStartViewEnd - dragStartViewStart);
        const velocityMultiplier = 2.8; 
        const pixelsPerItem = (canvas.clientWidth / visibleSpan) / velocityMultiplier;
        const itemsShifted = deltaX / pixelsPerItem;

        if (Math.abs(itemsShifted) >= 0.3) {
            let newStart = dragStartViewStart - itemsShifted;
            let newEnd = dragStartViewEnd - itemsShifted;

            if (newStart < 0) {
                newEnd -= newStart;
                newStart = 0;
            }
            if (newEnd > fullHistoryData.length - 1) {
                newStart -= (newEnd - (fullHistoryData.length - 1));
                newEnd = fullHistoryData.length - 1;
            }

            viewStart = Math.max(0, newStart);
            viewEnd = Math.min(fullHistoryData.length - 1, newEnd);
            showResetButton();
        }

        // Boosted Vertical Velocity (Stretch / Compress Price Height)
        if (Math.abs(deltaY) > 2) {
            const ySensitivity = 0.02; // 4x sensitivity increase
            const newYPadding = Math.max(0.05, Math.min(5.0, dragStartYPadding + (deltaY * ySensitivity)));
            if (Math.abs(newYPadding - yPaddingMultiplier) > 0.01) {
                yPaddingMultiplier = newYPadding;
                showResetButton();
            }
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

    // Mouse Wheel Zoom
    canvas.addEventListener('wheel', (e) => {
        if (fullHistoryData.length < 2) return;
        e.preventDefault();

        const zoomDirection = e.deltaY < 0 ? -1 : 1;
        const currentSpan = viewEnd - viewStart;
        const step = Math.max(1, Math.round(currentSpan * 0.2)) * zoomDirection;

        let newStart = viewStart + step;
        let newEnd = viewEnd - step;

        if (newEnd - newStart >= 1 && newStart >= 0 && newEnd < fullHistoryData.length) {
            viewStart = newStart;
            viewEnd = newEnd;
            showResetButton();
            renderChart();
        }
    }, { passive: false });

    // Touch Pinch Zoom
    canvas.addEventListener('touchmove', (e) => {
        if (e.touches.length === 2 && fullHistoryData.length >= 2) {
            e.preventDefault();
            const touch1 = e.touches[0];
            const touch2 = e.touches[1];
            const currentDistance = Math.hypot(touch1.clientX - touch2.clientX, touch1.clientY - touch2.clientY);

            if (initialPinchDistance) {
                const diff = currentDistance - initialPinchDistance;
                if (Math.abs(diff) > 4) {
                    const zoomDirection = diff > 0 ? -1 : 1;
                    const change = Math.max(1, Math.round((viewEnd - viewStart) * 0.12)) * zoomDirection;

                    let newStart = viewStart + change;
                    let newEnd = viewEnd - change;

                    if (newEnd - newStart >= 1 && newStart >= 0 && newEnd < fullHistoryData.length) {
                        viewStart = newStart;
                        viewEnd = newEnd;
                        showResetButton();
                        renderChart();
                    }
                    initialPinchDistance = currentDistance;
                }
            } else {
                initialPinchDistance = currentDistance;
            }
        }
    }, { passive: false });

    canvas.addEventListener('touchend', () => {
        initialPinchDistance = null;
    });
}

window.addEventListener('resize', () => {
    if (fullHistoryData.length > 0) {
        renderChart();
    }
});

// Expose globals
window.changeRange = changeRange;
window.resetSlideView = resetSlideView;
window.loadItemHistoryGraph = loadItemHistoryGraph;
window.renderChart = renderChart;
window.getSeasonForDate = getSeasonForDate;
window.updateActiveSeasonBadge = updateActiveSeasonBadge;

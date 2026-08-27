let allItems = [];
window.activeItem = null;
let autoRefreshTimer = null;
let currentTab = 'chart';

function formatDisplayPrice(price) {
    const num = parseFloat(price);
    if (isNaN(num)) return "0.00";
    if (num < 0.001) return num.toFixed(6).replace(/\.?0+$/, "");
    if (num < 1) return num.toFixed(4).replace(/\.?0+$/, "");
    return num.toFixed(2);
}
window.formatDisplayPrice = formatDisplayPrice;

// View Switcher: Chart vs Movers
function switchTab(tab) {
    currentTab = tab;
    const chartTab = document.getElementById('chartTabContent');
    const moversTab = document.getElementById('moversTabContent');
    const btnChart = document.getElementById('tabBtn-chart');
    const btnMovers = document.getElementById('tabBtn-movers');

    if (tab === 'chart') {
        if (chartTab) chartTab.classList.remove('hidden');
        if (moversTab) moversTab.classList.add('hidden');
        if (btnChart) btnChart.className = "px-2.5 py-1 rounded-lg transition bg-white dark:bg-zinc-800 text-amber-600 dark:text-amber-400 shadow-xs flex items-center gap-1";
        if (btnMovers) btnMovers.className = "px-2.5 py-1 rounded-lg transition text-zinc-500 hover:text-black dark:hover:text-white flex items-center gap-1";
        if (window.renderChart && window.fullHistoryData?.length > 0) {
            window.renderChart();
        }
    } else {
        if (chartTab) chartTab.classList.add('hidden');
        if (moversTab) moversTab.classList.remove('hidden');
        if (btnMovers) btnMovers.className = "px-2.5 py-1 rounded-lg transition bg-white dark:bg-zinc-800 text-amber-600 dark:text-amber-400 shadow-xs flex items-center gap-1";
        if (btnChart) btnChart.className = "px-2.5 py-1 rounded-lg transition text-zinc-500 hover:text-black dark:hover:text-white flex items-center gap-1";
    }
}
window.switchTab = switchTab;

function parseResourceItems(data) {
    if (!data) return [];
    if (Array.isArray(data)) {
        return data.map(item => ({
            name: item.name || item.item_name || "Unknown",
            price: parseFloat(item.price || item.current_price || 0)
        }));
    }
    const arrayKey = Object.keys(data).find(k => Array.isArray(data[k]));
    if (arrayKey) {
        return data[arrayKey].map(item => ({
            name: item.name || item.item_name || "Unknown",
            price: parseFloat(item.price || item.current_price || 0)
        }));
    }
    if (typeof data === 'object') {
        return Object.entries(data)
            .filter(([key]) => key !== 'error' && key !== 'status')
            .map(([name, val]) => ({
                name: name,
                price: typeof val === 'object' && val !== null ? parseFloat(val.price || 0) : parseFloat(val || 0)
            }));
    }
    return [];
}

async function fetchPrices() {
    const refreshIcon = document.getElementById('refreshIcon');
    const loadingState = document.getElementById('loadingState');
    const errorState = document.getElementById('errorState');

    if (refreshIcon) refreshIcon.classList.add('fa-spin');

    try {
        const res = await fetch('/api/prices');
        if (!res.ok) throw new Error(`Status: ${res.status}`);
        
        const rawData = await res.json();
        allItems = parseResourceItems(rawData);

        if (allItems.length === 0) throw new Error("No data received");

        if (loadingState) loadingState.classList.add('hidden');
        if (errorState) errorState.classList.add('hidden');

        populateDropdown();

        if (window.activeItem) {
            const fresh = allItems.find(i => i.name.toLowerCase() === window.activeItem.name.toLowerCase());
            if (fresh) selectItem(fresh, false);
        } else if (allItems.length > 0) {
            const sunflower = allItems.find(i => i.name.toLowerCase() === 'sunflower') || allItems[0];
            selectItem(sunflower, true);
        }
    } catch (err) {
        console.error("Fetch prices failed:", err);
        if (loadingState) loadingState.classList.add('hidden');
        if (errorState) {
            errorState.classList.remove('hidden');
            const msg = document.getElementById('errorMessage');
            if (msg) msg.innerText = err.message || "Failed to load prices.";
        }
    } finally {
        if (refreshIcon) refreshIcon.classList.remove('fa-spin');
    }
}

async function fetchMovers() {
    const gainersList = document.getElementById('gainersList');
    const losersList = document.getElementById('losersList');
    const badge = document.getElementById('moversCountBadge');

    try {
        const res = await fetch('/api/movers');
        if (!res.ok) throw new Error();
        const data = await res.json();

        const gainers = Array.isArray(data?.gainers) ? data.gainers : [];
        const losers = Array.isArray(data?.losers) ? data.losers : [];
        const totalCount = gainers.length + losers.length;

        if (badge) {
            badge.innerText = totalCount;
            if (totalCount > 0) badge.classList.remove('hidden');
            else badge.classList.add('hidden');
        }

        // Render Gainers
        if (gainersList) {
            if (gainers.length === 0) {
                gainersList.innerHTML = `<span class="text-[11px] text-zinc-400 italic py-1">No items up ≥5% in 12h</span>`;
            } else {
                gainersList.innerHTML = gainers.map(item => `
                    <button onclick="onMoverSelect('${item.name.replace(/'/g, "\\'")}')" 
                        class="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-white/70 dark:bg-black/40 hover:bg-white dark:hover:bg-zinc-900 border border-emerald-500/20 transition shadow-2xs active:scale-[0.98] cursor-pointer text-left">
                        <div class="min-w-0 flex items-center gap-1.5">
                            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0"></span>
                            <span class="text-xs font-black text-zinc-800 dark:text-zinc-100 truncate">${item.name}</span>
                        </div>
                        <div class="flex items-center gap-2 shrink-0 ml-2">
                            <span class="text-[10px] font-mono font-bold text-zinc-500 dark:text-zinc-400">${formatDisplayPrice(item.price)} SFL</span>
                            <span class="text-[10px] font-mono font-black text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-md border border-emerald-500/20">
                                +${parseFloat(item.changePct).toFixed(1)}%
                            </span>
                        </div>
                    </button>
                `).join('');
            }
        }

        // Render Losers
        if (losersList) {
            if (losers.length === 0) {
                losersList.innerHTML = `<span class="text-[11px] text-zinc-400 italic py-1">No items down ≤-5% in 12h</span>`;
            } else {
                losersList.innerHTML = losers.map(item => `
                    <button onclick="onMoverSelect('${item.name.replace(/'/g, "\\'")}')" 
                        class="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-white/70 dark:bg-black/40 hover:bg-white dark:hover:bg-zinc-900 border border-rose-500/20 transition shadow-2xs active:scale-[0.98] cursor-pointer text-left">
                        <div class="min-w-0 flex items-center gap-1.5">
                            <span class="w-1.5 h-1.5 rounded-full bg-rose-500 shrink-0"></span>
                            <span class="text-xs font-black text-zinc-800 dark:text-zinc-100 truncate">${item.name}</span>
                        </div>
                        <div class="flex items-center gap-2 shrink-0 ml-2">
                            <span class="text-[10px] font-mono font-bold text-zinc-500 dark:text-zinc-400">${formatDisplayPrice(item.price)} SFL</span>
                            <span class="text-[10px] font-mono font-black text-rose-600 dark:text-rose-400 bg-rose-500/10 px-1.5 py-0.5 rounded-md border border-rose-500/20">
                                ${parseFloat(item.changePct).toFixed(1)}%
                            </span>
                        </div>
                    </button>
                `).join('');
            }
        }
    } catch (err) {
        if (gainersList) gainersList.innerHTML = `<span class="text-[10px] text-zinc-500">Unavailable</span>`;
        if (losersList) losersList.innerHTML = `<span class="text-[10px] text-zinc-500">Unavailable</span>`;
    }
}

// When tapping a mover, select the item and switch immediately to Chart view
function onMoverSelect(itemName) {
    const item = allItems.find(i => i.name.toLowerCase() === itemName.toLowerCase()) || { name: itemName, price: 0 };
    const dropdown = document.getElementById('itemDropdown');
    const searchInput = document.getElementById('searchInput');
    if (dropdown) dropdown.value = itemName;
    if (searchInput) searchInput.value = itemName;
    
    switchTab('chart');
    selectItem(item, true);
}

function populateDropdown() {
    const dropdown = document.getElementById('itemDropdown');
    if (!dropdown || !Array.isArray(allItems)) return;

    const currentVal = dropdown.value;
    dropdown.innerHTML = '<option value="">Catalog ▾</option>';

    const sorted = [...allItems].sort((a, b) => a.name.localeCompare(b.name));
    sorted.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.name;
        opt.textContent = `${item.name} (${formatDisplayPrice(item.price)})`;
        dropdown.appendChild(opt);
    });

    if (currentVal) dropdown.value = currentVal;
}

function onDropdownSelect(itemName) {
    if (!itemName) return;
    const item = allItems.find(i => i.name.toLowerCase() === itemName.toLowerCase());
    if (item) {
        const searchInput = document.getElementById('searchInput');
        if (searchInput) searchInput.value = item.name;
        switchTab('chart');
        selectItem(item, true);
    }
}

function handleSearchInput(query) {
    const list = document.getElementById('autocompleteList');
    if (!list || !Array.isArray(allItems)) return;

    if (!query || query.trim() === '') {
        list.classList.add('hidden');
        return;
    }

    const q = query.toLowerCase().trim();
    const matches = allItems.filter(i => i.name.toLowerCase().includes(q)).slice(0, 6);

    if (matches.length === 0) {
        list.innerHTML = '<div class="p-3 text-xs text-zinc-400 text-center font-bold">No assets found</div>';
        list.classList.remove('hidden');
        return;
    }

    list.innerHTML = matches.map(m => `
        <div onclick="selectFromAutocomplete('${m.name.replace(/'/g, "\\'")}')" class="px-3.5 py-2 text-xs font-bold hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer flex items-center justify-between transition">
            <span class="text-zinc-900 dark:text-white font-extrabold">${m.name}</span>
            <span class="font-mono text-amber-600 dark:text-amber-400 font-bold">${formatDisplayPrice(m.price)} SFL</span>
        </div>
    `).join('');

    list.classList.remove('hidden');
}

function showAutocomplete() {
    const searchInput = document.getElementById('searchInput');
    if (searchInput && searchInput.value.trim() !== '') {
        handleSearchInput(searchInput.value);
    }
}

function selectFromAutocomplete(itemName) {
    const item = allItems.find(i => i.name.toLowerCase() === itemName.toLowerCase());
    if (item) {
        const searchInput = document.getElementById('searchInput');
        const dropdown = document.getElementById('itemDropdown');
        if (searchInput) searchInput.value = item.name;
        if (dropdown) dropdown.value = item.name;
        const list = document.getElementById('autocompleteList');
        if (list) list.classList.add('hidden');
        switchTab('chart');
        selectItem(item, true);
    }
}

document.addEventListener('click', (e) => {
    const list = document.getElementById('autocompleteList');
    const searchInput = document.getElementById('searchInput');
    if (list && searchInput && !list.contains(e.target) && e.target !== searchInput) {
        list.classList.add('hidden');
    }
});

function selectItem(item, loadGraph = true) {
    window.activeItem = item;

    const emptyState = document.getElementById('emptyState');
    const detailsContainer = document.getElementById('itemDetailsContainer');
    if (emptyState) emptyState.classList.add('hidden');
    if (detailsContainer) detailsContainer.classList.remove('hidden');

    const nameEl = document.getElementById('selectedItemName');
    const priceEl = document.getElementById('selectedItemPrice');
    const stack10El = document.getElementById('stack10Price');
    const stack100El = document.getElementById('stack100Price');
    const stack1000El = document.getElementById('stack1000Price');

    const price = parseFloat(item.price) || 0;

    if (nameEl) nameEl.innerText = item.name;
    if (priceEl) priceEl.innerText = formatDisplayPrice(price);
    if (stack10El) stack10El.innerText = formatDisplayPrice(price * 10);
    if (stack100El) stack100El.innerText = formatDisplayPrice(price * 100);
    if (stack1000El) stack1000El.innerText = formatDisplayPrice(price * 1000);

    calculateCustomStack();

    if (loadGraph && typeof window.loadItemHistoryGraph === 'function') {
        window.loadItemHistoryGraph(item.name);
    }
}

function calculateCustomStack() {
    const qtyInput = document.getElementById('calcQuantity');
    const resultEl = document.getElementById('calcResult');
    if (!qtyInput || !resultEl || !window.activeItem) return;

    const qty = Math.max(1, parseFloat(qtyInput.value) || 1);
    const price = parseFloat(window.activeItem.price) || 0;
    resultEl.innerText = formatDisplayPrice(qty * price);
}

document.addEventListener('DOMContentLoaded', () => {
    fetchPrices();
    fetchMovers();
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);
    autoRefreshTimer = setInterval(() => {
        fetchPrices();
        fetchMovers();
    }, 15000);
});

// Globals
window.fetchPrices = fetchPrices;
window.fetchMovers = fetchMovers;
window.onMoverSelect = onMoverSelect;
window.onDropdownSelect = onDropdownSelect;
window.handleSearchInput = handleSearchInput;
window.showAutocomplete = showAutocomplete;
window.selectFromAutocomplete = selectFromAutocomplete;
window.calculateCustomStack = calculateCustomStack;

let allItems = [];
window.activeItem = null;
let autoRefreshTimer = null;

// Format Price Helper
function formatDisplayPrice(price) {
    const num = parseFloat(price);
    if (isNaN(num)) return "0.00";
    if (num < 0.001) return num.toFixed(6).replace(/\.?0+$/, "");
    if (num < 1) return num.toFixed(4).replace(/\.?0+$/, "");
    return num.toFixed(2);
}
window.formatDisplayPrice = formatDisplayPrice;

// Universal Array Normalizer
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
            .filter(([key]) => key !== 'error' && key !== 'status' && key !== 'message')
            .map(([name, val]) => ({
                name: name,
                price: typeof val === 'object' && val !== null ? parseFloat(val.price || 0) : parseFloat(val || 0)
            }));
    }

    return [];
}

// Fetch Live Current Market Prices
async function fetchPrices() {
    const refreshIcon = document.getElementById('refreshIcon');
    const loadingState = document.getElementById('loadingState');
    const errorState = document.getElementById('errorState');

    if (refreshIcon) refreshIcon.classList.add('fa-spin');

    try {
        const res = await fetch('/api/prices');
        if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
        
        const rawData = await res.json();
        allItems = parseResourceItems(rawData);

        if (allItems.length === 0) {
            throw new Error("No pricing data returned from database");
        }

        if (loadingState) loadingState.classList.add('hidden');
        if (errorState) errorState.classList.add('hidden');

        populateDropdown();

        if (window.activeItem) {
            const fresh = allItems.find(i => i.name.toLowerCase() === window.activeItem.name.toLowerCase());
            if (fresh) {
                selectItem(fresh, false);
            }
        }
    } catch (err) {
        console.error("Fetch prices failed:", err);
        if (loadingState) loadingState.classList.add('hidden');
        if (errorState) {
            errorState.classList.remove('hidden');
            const msg = document.getElementById('errorMessage');
            if (msg) msg.innerText = err.message || "Failed to fetch pricing data.";
        }
    } finally {
        if (refreshIcon) refreshIcon.classList.remove('fa-spin');
    }
}

// Fetch 12H Movers (Horizontal Pill Rendering)
async function fetchMovers() {
    const strip = document.getElementById('moversStripContainer');

    try {
        const res = await fetch('/api/movers');
        if (!res.ok) throw new Error("Failed to load movers");
        const data = await res.json();

        const gainers = Array.isArray(data?.gainers) ? data.gainers : [];
        const losers = Array.isArray(data?.losers) ? data.losers : [];

        if (!strip) return;

        if (gainers.length === 0 && losers.length === 0) {
            strip.innerHTML = `<span class="text-[10px] text-[#7a6d5c] dark:text-zinc-500 font-semibold italic shrink-0">No assets moved $\\pm$5% in 12h</span>`;
            return;
        }

        const gainersHtml = gainers.map(item => `
            <button onclick="onMoverSelect('${item.name.replace(/'/g, "\\'")}')" 
                class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-emerald-100/90 dark:bg-emerald-950/60 border border-emerald-300 dark:border-emerald-800/80 hover:scale-105 active:scale-95 transition shadow-2xs shrink-0 cursor-pointer">
                <span class="text-[10px] font-black text-[#221a12] dark:text-zinc-100">${item.name}</span>
                <span class="text-[9px] font-mono font-black text-emerald-800 dark:text-emerald-400">+${parseFloat(item.changePct).toFixed(1)}%</span>
            </button>
        `).join('');

        const losersHtml = losers.map(item => `
            <button onclick="onMoverSelect('${item.name.replace(/'/g, "\\'")}')" 
                class="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-rose-100/90 dark:bg-rose-950/60 border border-rose-300 dark:border-rose-800/80 hover:scale-105 active:scale-95 transition shadow-2xs shrink-0 cursor-pointer">
                <span class="text-[10px] font-black text-[#221a12] dark:text-zinc-100">${item.name}</span>
                <span class="text-[9px] font-mono font-black text-rose-800 dark:text-rose-400">${parseFloat(item.changePct).toFixed(1)}%</span>
            </button>
        `).join('');

        strip.innerHTML = gainersHtml + losersHtml;
    } catch (err) {
        console.error("Movers fetch error:", err);
        if (strip) strip.innerHTML = `<span class="text-[10px] text-[#7a6d5c] dark:text-zinc-500 font-semibold shrink-0">Movers offline</span>`;
    }
}

// Click Handler for Movers Pill
function onMoverSelect(itemName) {
    const item = allItems.find(i => i.name.toLowerCase() === itemName.toLowerCase()) || { name: itemName, price: 0 };
    
    const dropdown = document.getElementById('itemDropdown');
    const searchInput = document.getElementById('searchInput');
    if (dropdown) dropdown.value = itemName;
    if (searchInput) searchInput.value = itemName;

    selectItem(item, true);
}

// Populate Dropdown Select
function populateDropdown() {
    const dropdown = document.getElementById('itemDropdown');
    if (!dropdown || !Array.isArray(allItems)) return;

    const currentVal = dropdown.value;
    dropdown.innerHTML = '<option value="">-- Choose from Catalog --</option>';

    const sorted = [...allItems].sort((a, b) => a.name.localeCompare(b.name));
    sorted.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.name;
        opt.textContent = `${item.name} (${formatDisplayPrice(item.price)} SFL)`;
        dropdown.appendChild(opt);
    });

    if (currentVal) dropdown.value = currentVal;
}

// Dropdown Change Handler
function onDropdownSelect(itemName) {
    if (!itemName) return;
    const item = allItems.find(i => i.name.toLowerCase() === itemName.toLowerCase());
    if (item) {
        const searchInput = document.getElementById('searchInput');
        if (searchInput) searchInput.value = item.name;
        selectItem(item, true);
    }
}

// Autocomplete Filter
function handleSearchInput(query) {
    const list = document.getElementById('autocompleteList');
    if (!list || !Array.isArray(allItems)) return;

    if (!query || query.trim() === '') {
        list.classList.add('hidden');
        return;
    }

    const q = query.toLowerCase().trim();
    const matches = allItems.filter(i => i.name.toLowerCase().includes(q)).slice(0, 8);

    if (matches.length === 0) {
        list.innerHTML = '<div class="p-2 text-xs text-[#7a6d5c] dark:text-zinc-500 text-center font-bold">No matching items</div>';
        list.classList.remove('hidden');
        return;
    }

    list.innerHTML = matches.map(m => `
        <div onclick="selectFromAutocomplete('${m.name.replace(/'/g, "\\'")}')" class="px-3 py-2 text-xs font-bold hover:bg-[#eae0cf] dark:hover:bg-[#1a1a24] cursor-pointer flex items-center justify-between transition">
            <span class="text-[#2b2219] dark:text-white font-extrabold">${m.name}</span>
            <span class="font-mono font-bold text-amber-800 dark:text-amber-400">${formatDisplayPrice(m.price)} SFL</span>
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

// Select Item and Render Workspace
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

function setupAutoRefresh() {
    const check = document.getElementById('autoRefreshCheck');
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);

    if (check && check.checked) {
        autoRefreshTimer = setInterval(() => {
            fetchPrices();
            fetchMovers();
        }, 15000);
    }

    if (check) {
        check.onchange = () => {
            if (check.checked) {
                setupAutoRefresh();
            } else if (autoRefreshTimer) {
                clearInterval(autoRefreshTimer);
            }
        };
    }
}

document.addEventListener('DOMContentLoaded', () => {
    fetchPrices();
    fetchMovers();
    setupAutoRefresh();
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

let allItems = [];
window.activeItem = null;
let autoRefreshTimer = null;

function formatDisplayPrice(price) {
    const num = parseFloat(price);
    if (isNaN(num)) return "0.00";
    if (num < 0.001) return num.toFixed(6).replace(/\.?0+$/, "");
    if (num < 1) return num.toFixed(4).replace(/\.?0+$/, "");
    return num.toFixed(2);
}
window.formatDisplayPrice = formatDisplayPrice;

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
            // Auto-select Sunflower on first launch
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
    const strip = document.getElementById('moversStripContainer');
    try {
        const res = await fetch('/api/movers');
        if (!res.ok) throw new Error();
        const data = await res.json();

        const gainers = Array.isArray(data?.gainers) ? data.gainers : [];
        const losers = Array.isArray(data?.losers) ? data.losers : [];

        if (!strip) return;
        if (gainers.length === 0 && losers.length === 0) {
            strip.innerHTML = `<span class="text-[10px] text-zinc-500 font-semibold italic">No assets moved ±5% in 12h</span>`;
            return;
        }

        const gainersHtml = gainers.map(item => `
            <button onclick="onMoverSelect('${item.name.replace(/'/g, "\\'")}')" 
                class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20 shrink-0 text-xs font-bold hover:scale-105 transition active:scale-95">
                <span>${item.name}</span>
                <span class="font-mono text-[10px] font-black">+${parseFloat(item.changePct).toFixed(1)}%</span>
            </button>
        `).join('');

        const losersHtml = losers.map(item => `
            <button onclick="onMoverSelect('${item.name.replace(/'/g, "\\'")}')" 
                class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-xl bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20 shrink-0 text-xs font-bold hover:scale-105 transition active:scale-95">
                <span>${item.name}</span>
                <span class="font-mono text-[10px] font-black">${parseFloat(item.changePct).toFixed(1)}%</span>
            </button>
        `).join('');

        strip.innerHTML = gainersHtml + losersHtml;
    } catch (err) {
        if (strip) strip.innerHTML = `<span class="text-[10px] text-zinc-500 font-semibold">Movers unavailable</span>`;
    }
}

function onMoverSelect(itemName) {
    const item = allItems.find(i => i.name.toLowerCase() === itemName.toLowerCase()) || { name: itemName, price: 0 };
    const dropdown = document.getElementById('itemDropdown');
    const searchInput = document.getElementById('searchInput');
    if (dropdown) dropdown.value = itemName;
    if (searchInput) searchInput.value = itemName;
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
        <div onclick="selectFromAutocomplete('${m.name.replace(/'/g, "\\'")}')" class="px-3.5 py-2.5 text-xs font-bold hover:bg-black/5 dark:hover:bg-white/5 cursor-pointer flex items-center justify-between transition">
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

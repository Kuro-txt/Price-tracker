let rawItems = [];
let autoRefreshTimer = null;
window.activeItem = null;

// Theme Controller
function toggleTheme() {
    const html = document.documentElement;
    if (html.classList.contains('dark')) {
        html.classList.remove('dark');
        localStorage.setItem('theme', 'light');
    } else {
        html.classList.add('dark');
        localStorage.setItem('theme', 'dark');
    }
    if (window.lastHistoryData && window.lastHistoryData.length > 0) {
        window.renderChart(window.lastHistoryData);
    }
}

async function fetchPrices() {
    const loadingState = document.getElementById('loadingState');
    const errorState = document.getElementById('errorState');
    const refreshIcon = document.getElementById('refreshIcon');
    const lastUpdatedLabel = document.getElementById('lastUpdatedLabel');

    if (rawItems.length === 0) {
        loadingState.classList.remove('hidden');
        document.getElementById('emptyState').classList.add('hidden');
        document.getElementById('itemDetailsContainer').classList.add('hidden');
    }
    errorState.classList.add('hidden');
    if (refreshIcon) refreshIcon.classList.add('fa-spin');

    const endpoints = [
        '/api/prices',
        'https://api.allorigins.win/raw?url=' + encodeURIComponent('https://sfl.world/api/v1/prices'),
        'https://sfl.world/api/v1/prices'
    ];

    let result = null;
    for (const url of endpoints) {
        try {
            const res = await fetch(url);
            if (res.ok) {
                result = await res.json();
                break;
            }
        } catch (e) {}
    }

    if (refreshIcon) refreshIcon.classList.remove('fa-spin');

    if (!result || !result.data) {
        if (rawItems.length === 0) {
            loadingState.classList.add('hidden');
            errorState.classList.remove('hidden');
            document.getElementById('errorMessage').innerText = "Unable to reach SFL API. Ensure your backend proxy is active.";
        }
        return;
    }

    try {
        const timeText = result.updated_text || (result.updatedAt ? new Date(result.updatedAt).toLocaleTimeString() : 'Just now');
        if (lastUpdatedLabel) lastUpdatedLabel.innerText = `Last sync: ${timeText}`;

        const p2pData = result.data.p2p || result.data || {};
        rawItems = Object.entries(p2pData).map(([name, price]) => ({
            name: name,
            price: parseFloat(price) || 0
        }));

        populateItemDropdown();
        loadingState.classList.add('hidden');

        if (window.activeItem) {
            selectItem(window.activeItem.name);
        } else {
            document.getElementById('emptyState').classList.remove('hidden');
        }
    } catch (err) {
        console.error("Format parsing error:", err);
    }
}

function populateItemDropdown() {
    const dropdown = document.getElementById('itemDropdown');
    const previousVal = dropdown.value;
    dropdown.innerHTML = '<option value="">-- Choose an item --</option>';

    const sorted = [...rawItems].sort((a, b) => a.name.localeCompare(b.name));
    sorted.forEach(item => {
        const opt = document.createElement('option');
        opt.value = item.name;
        opt.textContent = `${item.name} (${formatDisplayPrice(item.price)} SFL)`;
        if (window.activeItem && item.name === window.activeItem.name) opt.selected = true;
        dropdown.appendChild(opt);
    });
}

function handleSearchInput(query) {
    showAutocomplete(query);
}

function showAutocomplete(query = document.getElementById('searchInput').value) {
    const list = document.getElementById('autocompleteList');
    const filtered = rawItems.filter(i => i.name.toLowerCase().includes(query.toLowerCase()));

    if (!query || filtered.length === 0) {
        list.classList.add('hidden');
        return;
    }

    list.innerHTML = '';
    filtered.slice(0, 8).forEach(item => {
        const div = document.createElement('div');
        div.className = "px-4 py-3 text-xs text-stone-700 dark:text-slate-200 hover:bg-amber-50 dark:hover:bg-slate-800 cursor-pointer flex justify-between items-center transition font-medium";
        div.innerHTML = `
            <span>${item.name}</span>
            <span class="font-mono text-amber-600 dark:text-amber-400 font-bold">${formatDisplayPrice(item.price)} SFL</span>
        `;
        div.onclick = () => {
            selectItem(item.name);
            list.classList.add('hidden');
        };
        list.appendChild(div);
    });

    list.classList.remove('hidden');
}

function onDropdownSelect(itemName) {
    if (itemName) {
        selectItem(itemName);
    } else {
        window.activeItem = null;
        document.getElementById('emptyState').classList.remove('hidden');
        document.getElementById('itemDetailsContainer').classList.add('hidden');
    }
}

async function selectItem(name) {
    const item = rawItems.find(i => i.name.toLowerCase() === name.toLowerCase());
    if (!item) return;

    window.activeItem = item;

    document.getElementById('searchInput').value = item.name;
    document.getElementById('itemDropdown').value = item.name;

    document.getElementById('selectedItemName').innerText = item.name;
    document.getElementById('selectedItemPrice').innerText = formatDisplayPrice(item.price);
    document.getElementById('stack10Price').innerText = formatDisplayPrice(item.price * 10);
    document.getElementById('stack100Price').innerText = formatDisplayPrice(item.price * 100);
    document.getElementById('stack1000Price').innerText = formatDisplayPrice(item.price * 1000);

    calculateCustomStack();

    document.getElementById('emptyState').classList.add('hidden');
    document.getElementById('itemDetailsContainer').classList.remove('hidden');

    await window.loadItemHistoryGraph(item.name);
}

function calculateCustomStack() {
    if (!window.activeItem) return;
    const qty = parseFloat(document.getElementById('calcQuantity').value) || 0;
    const total = qty * window.activeItem.price;
    document.getElementById('calcResult').innerText = formatDisplayPrice(total);
}

function formatDisplayPrice(price) {
    if (!price || price === 0) return "0.00";
    if (price < 0.001) return price.toFixed(8).replace(/\.?0+$/, "");
    if (price < 1) return price.toFixed(6).replace(/\.?0+$/, "");
    return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
}

function setupAutoRefresh() {
    const check = document.getElementById('autoRefreshCheck');
    if (autoRefreshTimer) clearInterval(autoRefreshTimer);

    if (check && check.checked) {
        autoRefreshTimer = setInterval(() => {
            fetchPrices();
        }, 15000);
    }

    if (check) check.addEventListener('change', setupAutoRefresh);
}

// Global Click Handlers
document.addEventListener('click', (e) => {
    if (!e.target.closest('#searchInput') && !e.target.closest('#autocompleteList')) {
        const list = document.getElementById('autocompleteList');
        if (list) list.classList.add('hidden');
    }
});

document.addEventListener('DOMContentLoaded', () => {
    fetchPrices();
    setupAutoRefresh();
});

// Expose globals
window.toggleTheme = toggleTheme;
window.fetchPrices = fetchPrices;
window.handleSearchInput = handleSearchInput;
window.showAutocomplete = showAutocomplete;
window.onDropdownSelect = onDropdownSelect;
window.selectItem = selectItem;
window.calculateCustomStack = calculateCustomStack;
window.formatDisplayPrice = formatDisplayPrice;

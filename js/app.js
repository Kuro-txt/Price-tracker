let allItems = [];
window.activeItem = null;
let autoRefreshTimer = null;
let currentTab = 'movers';
let currentTaxRate = 10.0;
let movers12hMap = {};

// Load Settings from LocalStorage
try {
    const savedTax = localStorage.getItem('sunchart_tax_rate');
    if (savedTax) currentTaxRate = parseFloat(savedTax) || 10.0;
} catch (_) {}

let watchlist = [];
try {
    const saved = localStorage.getItem('sunchart_watchlist');
    watchlist = saved ? JSON.parse(saved) : ['Sunflower', 'Iron', 'Egg', 'Gold'];
} catch (_) {
    watchlist = ['Sunflower', 'Iron', 'Egg', 'Gold'];
}

function formatDisplayPrice(price) {
    const num = parseFloat(price);
    if (isNaN(num)) return "0.00";
    if (num < 0.001) return num.toFixed(6).replace(/\.?0+$/, "");
    if (num < 1) return num.toFixed(4).replace(/\.?0+$/, "");
    return num.toFixed(2);
}
window.formatDisplayPrice = formatDisplayPrice;

// Calculator & Tax Storage Helpers
function saveItemCalcState(itemName, qty, buyPrice) {
    if (!itemName) return;
    try {
        const map = JSON.parse(localStorage.getItem('sunchart_calc_map') || '{}');
        map[itemName.toLowerCase()] = { qty, buyPrice };
        localStorage.setItem('sunchart_calc_map', JSON.stringify(map));
    } catch (_) {}
}

function loadItemCalcState(itemName) {
    if (!itemName) return { qty: 50, buyPrice: '' };
    try {
        const map = JSON.parse(localStorage.getItem('sunchart_calc_map') || '{}');
        return map[itemName.toLowerCase()] || { qty: 50, buyPrice: '' };
    } catch (_) {
        return { qty: 50, buyPrice: '' };
    }
}

// Tax Rate Controller
function onTaxRateChange(val) {
    currentTaxRate = parseFloat(val) || 10.0;
    try {
        localStorage.setItem('sunchart_tax_rate', currentTaxRate.toString());
    } catch (_) {}
    calculateCustomStack();
}
window.onTaxRateChange = onTaxRateChange;

function syncTaxSelectorUI() {
    const select = document.getElementById('taxRateSelect');
    if (select) select.value = currentTaxRate.toString();
}

// Tab Switcher (Movers vs Chart vs Watchlist)
function switchTab(tab) {
    currentTab = tab;
    const chartTab = document.getElementById('chartTabContent');
    const moversTab = document.getElementById('moversTabContent');
    const watchlistTab = document.getElementById('watchlistTabContent');

    const btnChart = document.getElementById('tabBtn-chart');
    const btnMovers = document.getElementById('tabBtn-movers');
    const btnWatchlist = document.getElementById('tabBtn-watchlist');

    const inactiveClass = "py-1 rounded-lg transition text-[#6d5e4d] dark:text-zinc-400 hover:text-black dark:hover:text-white flex items-center justify-center gap-1";
    const activeClass = "py-1 rounded-lg transition bg-[#fbf8f2] dark:bg-zinc-800 text-amber-900 dark:text-amber-400 shadow-xs flex items-center justify-center gap-1";

    if (chartTab) chartTab.classList.add('hidden');
    if (moversTab) moversTab.classList.add('hidden');
    if (watchlistTab) watchlistTab.classList.add('hidden');

    if (btnChart) btnChart.className = inactiveClass;
    if (btnMovers) btnMovers.className = inactiveClass;
    if (btnWatchlist) btnWatchlist.className = inactiveClass;

    if (tab === 'movers') {
        if (moversTab) moversTab.classList.remove('hidden');
        if (btnMovers) btnMovers.className = activeClass;
    } else if (tab === 'chart') {
        if (chartTab) chartTab.classList.remove('hidden');
        if (btnChart) btnChart.className = activeClass;
        if (window.renderChart && window.fullHistoryData?.length > 0) {
            window.renderChart();
        }
    } else if (tab === 'watchlist') {
        if (watchlistTab) watchlistTab.classList.remove('hidden');
        if (btnWatchlist) btnWatchlist.className = activeClass;
        renderWatchlist();
    }
}
window.switchTab = switchTab;

// Watchlist Helpers
function saveWatchlist() {
    try {
        localStorage.setItem('sunchart_watchlist', JSON.stringify(watchlist));
    } catch (_) {}
    updateWatchlistBadge();
    updateActiveItemStar();
    renderWatchlist();
}

function updateWatchlistBadge() {
    const badge = document.getElementById('watchlistCountBadge');
    if (!badge) return;
    badge.innerText = watchlist.length;
    if (watchlist.length > 0) badge.classList.remove('hidden');
    else badge.classList.add('hidden');
}

function toggleWatchlist(itemName) {
    if (!itemName) return;
    const index = watchlist.findIndex(name => name.toLowerCase() === itemName.toLowerCase());
    if (index >= 0) {
        watchlist.splice(index, 1);
    } else {
        watchlist.push(itemName);
    }
    saveWatchlist();
}
window.toggleWatchlist = toggleWatchlist;

function toggleActiveItemWatchlist() {
    if (!window.activeItem) return;
    toggleWatchlist(window.activeItem.name);
}
window.toggleActiveItemWatchlist = toggleActiveItemWatchlist;

function updateActiveItemStar() {
    const starBtn = document.getElementById('watchlistStarBtn');
    const starIcon = document.getElementById('watchlistStarIcon');
    if (!starBtn || !starIcon || !window.activeItem) return;

    const isWatched = watchlist.some(name => name.toLowerCase() === window.activeItem.name.toLowerCase());

    if (isWatched) {
        starBtn.className = "w-7 h-7 rounded-xl flex items-center justify-center transition active:scale-90 bg-amber-500/20 text-amber-800 dark:text-amber-500 border border-amber-600/30";
        starIcon.className = "fa-solid fa-star text-xs text-amber-800 dark:text-amber-500";
    } else {
        starBtn.className = "w-7 h-7 rounded-xl flex items-center justify-center transition active:scale-90 bg-[#ede3d1] dark:bg-white/5 hover:bg-amber-500/20 border border-[#cbbeaa] dark:border-transparent text-[#6d5e4d] dark:text-zinc-400 hover:text-amber-800";
        starIcon.className = "fa-regular fa-star text-xs";
    }
}

// Watchlist Renderer with High-Contrast Light Mode Elements
function renderWatchlist() {
    const grid = document.getElementById('watchlistGrid');
    if (!grid) return;

    if (watchlist.length === 0) {
        grid.innerHTML = `
            <div class="text-center py-8 space-y-1.5">
                <div class="w-8 h-8 rounded-full bg-amber-500/20 text-amber-800 dark:text-amber-500 flex items-center justify-center mx-auto text-xs">
                    <i class="fa-regular fa-star"></i>
                </div>
                <p class="text-xs font-black text-[#1f1710] dark:text-zinc-300">Watchlist is Empty</p>
                <p class="text-[10px] text-[#6d5e4d] dark:text-zinc-400 font-medium max-w-xs mx-auto">Tap the star icon on any resource to track its floor and 12h price movement here.</p>
            </div>
        `;
        return;
    }

    grid.innerHTML = watchlist.map(name => {
        const item = allItems.find(i => i.name.toLowerCase() === name.toLowerCase()) || { name: name, price: 0 };
        const moverData = movers12hMap[name.toLowerCase()];
        
        let changeBadgeHtml = '';
        if (moverData && typeof moverData.changePct === 'number') {
            const pct = moverData.changePct;
            if (pct > 0.001) {
                changeBadgeHtml = `
                    <span class="text-[9px] font-mono font-black text-emerald-900 dark:text-emerald-400 bg-emerald-500/15 dark:bg-emerald-500/10 px-1.5 py-0.5 rounded-md border border-emerald-600/30 dark:border-emerald-500/20">
                        +${pct.toFixed(1)}% (12H)
                    </span>
                `;
            } else if (pct < -0.001) {
                changeBadgeHtml = `
                    <span class="text-[9px] font-mono font-black text-rose-900 dark:text-rose-400 bg-rose-500/15 dark:bg-rose-500/10 px-1.5 py-0.5 rounded-md border border-rose-600/30 dark:border-rose-500/20">
                        ${pct.toFixed(1)}% (12H)
                    </span>
                `;
            } else {
                changeBadgeHtml = `
                    <span class="text-[9px] font-mono font-bold text-[#5c4d3d] dark:text-zinc-400 bg-[#ede3d1] dark:bg-white/5 border border-[#cbbeaa] dark:border-transparent px-1.5 py-0.5 rounded-md">
                        0.0% (12H)
                    </span>
                `;
            }
        } else {
            changeBadgeHtml = `
                <span class="text-[9px] font-mono font-bold text-[#5c4d3d] dark:text-zinc-400 bg-[#ede3d1] dark:bg-white/5 border border-[#cbbeaa] dark:border-transparent px-1.5 py-0.5 rounded-md">
                    -- (12H)
                </span>
            `;
        }

        return `
            <div class="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-[#ede3d1] dark:bg-black/40 hover:bg-[#e4d8c2] dark:hover:bg-zinc-900 border border-[#cbbeaa] dark:border-white/10 transition shadow-2xs group">
                <div onclick="onMoverSelect('${item.name.replace(/'/g, "\\'")}')" class="flex-1 min-w-0 flex items-center gap-2 cursor-pointer">
                    <span class="w-1.5 h-1.5 rounded-full bg-amber-600 dark:bg-amber-500 shrink-0"></span>
                    <span class="text-xs font-black text-[#1f1710] dark:text-zinc-100 truncate">${item.name}</span>
                </div>

                <div class="flex items-center gap-2.5 shrink-0 ml-2">
                    ${changeBadgeHtml}

                    <div onclick="onMoverSelect('${item.name.replace(/'/g, "\\'")}')" class="text-right cursor-pointer min-w-[55px]">
                        <span class="text-xs font-mono font-black text-amber-900 dark:text-amber-400">${formatDisplayPrice(item.price)}</span>
                        <span class="text-[8px] font-bold text-[#6d5e4d] dark:text-zinc-400">SFL</span>
                    </div>

                    <button onclick="toggleWatchlist('${item.name.replace(/'/g, "\\'")}')" title="Remove from Watchlist" 
                        class="w-6 h-6 rounded-lg flex items-center justify-center bg-[#fbf8f2] dark:bg-white/5 hover:bg-rose-500/20 text-[#6d5e4d] hover:text-rose-700 border border-[#cbbeaa] dark:border-transparent transition active:scale-90">
                        <i class="fa-solid fa-xmark text-[11px]"></i>
                    </button>
                </div>
            </div>
        `;
    }).join('');
}

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
        renderWatchlist();

        if (window.activeItem) {
            const fresh = allItems.find(i => i.name.toLowerCase() === window.activeItem.name.toLowerCase());
            if (fresh) selectItem(fresh, false);
        } else if (allItems.length > 0) {
            const savedItemName = localStorage.getItem('sunchart_last_selected_item');
            const targetItem = (savedItemName && allItems.find(i => i.name.toLowerCase() === savedItemName.toLowerCase()))
                || allItems.find(i => i.name.toLowerCase() === 'sunflower') 
                || allItems[0];
            selectItem(targetItem, true);
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
        movers12hMap = data?.changesMap || {};

        const totalCount = gainers.length + losers.length;

        if (badge) {
            badge.innerText = totalCount;
            if (totalCount > 0) badge.classList.remove('hidden');
            else badge.classList.add('hidden');
        }

        // Render Gainers
        if (gainersList) {
            if (gainers.length === 0) {
                gainersList.innerHTML = `<span class="text-[11px] text-[#6d5e4d] dark:text-zinc-400 font-bold italic py-1">No items up ≥5% in 12h</span>`;
            } else {
                gainersList.innerHTML = gainers.map(item => `
                    <button onclick="onMoverSelect('${item.name.replace(/'/g, "\\'")}')" 
                        class="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[#fbf8f2] dark:bg-black/40 hover:bg-[#ede3d1] dark:hover:bg-zinc-900 border border-emerald-600/30 dark:border-emerald-500/20 transition shadow-2xs active:scale-[0.98] cursor-pointer text-left">
                        <div class="min-w-0 flex items-center gap-1.5">
                            <span class="w-1.5 h-1.5 rounded-full bg-emerald-600 dark:bg-emerald-500 shrink-0"></span>
                            <span class="text-xs font-black text-[#1f1710] dark:text-zinc-100 truncate">${item.name}</span>
                        </div>
                        <div class="flex items-center gap-2 shrink-0 ml-2">
                            <span class="text-[10px] font-mono font-bold text-[#423425] dark:text-zinc-400">${formatDisplayPrice(item.price)} SFL</span>
                            <span class="text-[10px] font-mono font-black text-emerald-900 dark:text-emerald-400 bg-emerald-500/15 dark:bg-emerald-500/10 px-1.5 py-0.5 rounded-md border border-emerald-600/30 dark:border-emerald-500/20">
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
                losersList.innerHTML = `<span class="text-[11px] text-[#6d5e4d] dark:text-zinc-400 font-bold italic py-1">No items down ≤-5% in 12h</span>`;
            } else {
                losersList.innerHTML = losers.map(item => `
                    <button onclick="onMoverSelect('${item.name.replace(/'/g, "\\'")}')" 
                        class="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[#fbf8f2] dark:bg-black/40 hover:bg-[#ede3d1] dark:hover:bg-zinc-900 border border-rose-600/30 dark:border-rose-500/20 transition shadow-2xs active:scale-[0.98] cursor-pointer text-left">
                        <div class="min-w-0 flex items-center gap-1.5">
                            <span class="w-1.5 h-1.5 rounded-full bg-rose-600 dark:bg-rose-500 shrink-0"></span>
                            <span class="text-xs font-black text-[#1f1710] dark:text-zinc-100 truncate">${item.name}</span>
                        </div>
                        <div class="flex items-center gap-2 shrink-0 ml-2">
                            <span class="text-[10px] font-mono font-bold text-[#423425] dark:text-zinc-400">${formatDisplayPrice(item.price)} SFL</span>
                            <span class="text-[10px] font-mono font-black text-rose-900 dark:text-rose-400 bg-rose-500/15 dark:bg-rose-500/10 px-1.5 py-0.5 rounded-md border border-rose-600/30 dark:border-rose-500/20">
                                ${parseFloat(item.changePct).toFixed(1)}%
                            </span>
                        </div>
                    </button>
                `).join('');
            }
        }

        renderWatchlist();
    } catch (err) {
        if (gainersList) gainersList.innerHTML = `<span class="text-[10px] text-[#6d5e4d]">Unavailable</span>`;
        if (losersList) losersList.innerHTML = `<span class="text-[10px] text-[#6d5e4d]">Unavailable</span>`;
    }
}

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
        list.innerHTML = '<div class="p-3 text-xs text-[#6d5e4d] text-center font-bold">No assets found</div>';
        list.classList.remove('hidden');
        return;
    }

    list.innerHTML = matches.map(m => `
        <div onclick="selectFromAutocomplete('${m.name.replace(/'/g, "\\'")}')" class="px-3.5 py-2 text-xs font-bold hover:bg-[#ede3d1] dark:hover:bg-white/5 cursor-pointer flex items-center justify-between transition">
            <span class="text-[#1f1710] dark:text-white font-extrabold">${m.name}</span>
            <span class="font-mono text-amber-900 dark:text-amber-400 font-bold">${formatDisplayPrice(m.price)} SFL</span>
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

// Select Item & Restore its Specific Calculator Inputs
function selectItem(item, loadGraph = true) {
    window.activeItem = item;
    try {
        localStorage.setItem('sunchart_last_selected_item', item.name);
    } catch (_) {}

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

    // Restore saved item-specific Qty and Buy Price
    const savedState = loadItemCalcState(item.name);
    const qtyInput = document.getElementById('calcQuantity');
    const buyInput = document.getElementById('calcBuyPrice');
    if (qtyInput) qtyInput.value = savedState.qty || 50;
    if (buyInput) buyInput.value = savedState.buyPrice !== undefined && savedState.buyPrice !== null ? savedState.buyPrice : '';

    updateActiveItemStar();
    calculateCustomStack(false);

    if (loadGraph && typeof window.loadItemHistoryGraph === 'function') {
        window.loadItemHistoryGraph(item.name);
    }
}

function setQuantity(val) {
    const qtyInput = document.getElementById('calcQuantity');
    if (!qtyInput) return;
    qtyInput.value = Math.max(1, parseInt(val) || 1);
    calculateCustomStack();
}
window.setQuantity = setQuantity;

function addQuantity(amount) {
    const qtyInput = document.getElementById('calcQuantity');
    if (!qtyInput) return;
    const current = parseInt(qtyInput.value) || 0;
    qtyInput.value = Math.max(1, current + amount);
    calculateCustomStack();
}
window.addQuantity = addQuantity;

// Net Profit, Plaza Tax & Target Profit Engine
function calculateCustomStack(shouldSave = true) {
    const qtyInput = document.getElementById('calcQuantity');
    const buyInput = document.getElementById('calcBuyPrice');
    const grossEl = document.getElementById('calcGross');
    const feeLabelEl = document.getElementById('calcFeeLabel');
    const feeEl = document.getElementById('calcFee');
    const costEl = document.getElementById('calcCost');
    const profitEl = document.getElementById('calcProfit');
    const profitLabelEl = document.getElementById('calcProfitLabel');
    const profitUnitEl = document.getElementById('calcProfitUnit');

    const target5El = document.getElementById('target5Price');
    const target10El = document.getElementById('target10Price');
    const target5Label = document.getElementById('target5Label');
    const target10Label = document.getElementById('target10Label');

    if (!qtyInput || !grossEl || !window.activeItem) return;

    const qty = Math.max(1, parseFloat(qtyInput.value) || 1);
    const currentPrice = parseFloat(window.activeItem.price) || 0;
    const buyPriceRaw = buyInput ? buyInput.value : '';
    const buyPrice = buyPriceRaw !== '' ? Math.max(0, parseFloat(buyPriceRaw) || 0) : 0;

    if (shouldSave && window.activeItem) {
        saveItemCalcState(window.activeItem.name, qty, buyPriceRaw);
    }

    const taxRateFraction = currentTaxRate / 100.0;
    const gross = qty * currentPrice;
    const fee = gross * taxRateFraction;
    const netYield = gross - fee;
    const totalCost = qty * buyPrice;
    const profit = netYield - totalCost;

    grossEl.innerText = formatDisplayPrice(gross);
    if (feeLabelEl) feeLabelEl.innerText = `Plaza Tax (-${currentTaxRate}%)`;
    if (feeEl) feeEl.innerText = `-${formatDisplayPrice(fee)}`;
    if (costEl) costEl.innerText = formatDisplayPrice(totalCost);

    // Target Profit Price Calculation based on Bought Price + Plaza Tax
    const netMultiplier = 1.0 - taxRateFraction;
    if (buyPrice > 0 && netMultiplier > 0) {
        const target5SellPrice = (buyPrice * 1.05) / netMultiplier;
        const target10SellPrice = (buyPrice * 1.10) / netMultiplier;

        if (target5El) target5El.innerText = `${formatDisplayPrice(target5SellPrice)} SFL`;
        if (target10El) target10El.innerText = `${formatDisplayPrice(target10SellPrice)} SFL`;
        if (target5Label) target5Label.innerText = "+5% Profit Target:";
        if (target10Label) target10Label.innerText = "+10% Profit Target:";
    } else {
        if (target5El) target5El.innerText = `${formatDisplayPrice(currentPrice * 1.05)} SFL`;
        if (target10El) target10El.innerText = `${formatDisplayPrice(currentPrice * 1.10)} SFL`;
        if (target5Label) target5Label.innerText = "+5% Target:";
        if (target10Label) target10Label.innerText = "+10% Target:";
    }

    if (profitEl) {
        profitEl.innerText = `${profit >= 0 ? '+' : ''}${formatDisplayPrice(profit)}`;
        
        if (profit > 0.000001) {
            profitEl.className = "font-mono font-black text-xs sm:text-sm text-emerald-900 dark:text-emerald-400";
            if (profitLabelEl) {
                const roi = totalCost > 0 ? ((profit / totalCost) * 100).toFixed(1) : 0;
                profitLabelEl.className = "block font-black text-[8px] uppercase text-emerald-900 dark:text-emerald-400";
                profitLabelEl.innerText = totalCost > 0 ? `Net Profit (+${roi}%)` : `Net Yield`;
            }
            if (profitUnitEl) profitUnitEl.className = "text-[8px] font-black text-emerald-900/80 dark:text-emerald-400/70";
        } else if (profit < -0.000001) {
            profitEl.className = "font-mono font-black text-xs sm:text-sm text-rose-900 dark:text-rose-400";
            if (profitLabelEl) {
                const roi = totalCost > 0 ? ((profit / totalCost) * 100).toFixed(1) : 0;
                profitLabelEl.className = "block font-black text-[8px] uppercase text-rose-900 dark:text-rose-400";
                profitLabelEl.innerText = `Net Loss (${roi}%)`;
            }
            if (profitUnitEl) profitUnitEl.className = "text-[8px] font-black text-rose-900/80 dark:text-rose-400/70";
        } else {
            profitEl.className = "font-mono font-black text-xs sm:text-sm text-[#423425] dark:text-zinc-400";
            if (profitLabelEl) {
                profitLabelEl.className = "block font-black text-[8px] uppercase text-[#6d5e4d] dark:text-zinc-400";
                profitLabelEl.innerText = `Net Yield`;
            }
            if (profitUnitEl) profitUnitEl.className = "text-[8px] font-black text-[#6d5e4d] dark:text-zinc-400";
        }
    }
}

// App Boot
document.addEventListener('DOMContentLoaded', () => {
    syncTaxSelectorUI();
    switchTab('movers');
    updateWatchlistBadge();
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

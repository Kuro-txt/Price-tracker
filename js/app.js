"use strict";

// ─── State ────────────────────────────────────────────────────────────────────
let allItems         = [];
window.activeItem    = null;
let autoRefreshTimer = null;
let currentTab       = "movers";
let currentTaxRate   = 10.0;
let movers12hMap     = {};
let _lastGainers     = [];
let _lastLosers      = [];

// ─── Persisted Settings ───────────────────────────────────────────────────────
try {
    const savedTax = localStorage.getItem("sunchart_tax_rate");
    if (savedTax) currentTaxRate = parseFloat(savedTax) || 10.0;
} catch (_) {}

let watchlist = [];
try {
    const saved = localStorage.getItem("sunchart_watchlist");
    watchlist = saved ? JSON.parse(saved) : ["Sunflower", "Iron", "Egg", "Gold"];
} catch (_) { watchlist = ["Sunflower", "Iron", "Egg", "Gold"]; }

// ─── Service Worker Registration (PWA Offline / Performance) ──────────────────
if ("serviceWorker" in navigator) {
    window.addEventListener("load", async () => {
        try {
            await navigator.serviceWorker.register("/sw.js");
        } catch (_) {}
    });
}

// ─── Utilities & Exact Decimal Formatting ─────────────────────────────────────
function escapeHtml(str) {
    return String(str)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

function formatDisplayPrice(price) {
    if (price === null || price === undefined || price === "") return "0";
    const num = parseFloat(price);
    if (isNaN(num)) return "0";
    const fixed = num.toFixed(8);
    return fixed.includes(".") ? fixed.replace(/\.?0+$/, "") : fixed;
}
window.formatDisplayPrice = formatDisplayPrice;

function showToast(message, type = "info", durationMs = 3500) {
    const toast = document.createElement("div");
    toast.className = `toast ${type}`;
    toast.innerHTML = message;
    document.body.appendChild(toast);
    setTimeout(() => {
        toast.style.opacity = "0";
        setTimeout(() => toast.remove(), 350);
    }, durationMs);
}
window.showToast = showToast;

// ─── Local Time-Series Price History Logger ───────────────────────────────────
function recordLocalPriceHistory(items) {
    if (!Array.isArray(items) || items.length === 0) return;
    try {
        const store = JSON.parse(localStorage.getItem("sunchart_local_history_series") || "[]");
        const now = Date.now();
        const snap = { t: now, p: {} };
        items.forEach(i => {
            if (i.name && typeof i.price === "number") {
                snap.p[i.name.toLowerCase()] = i.price;
            }
        });

        // Don't record duplicate timestamps within 30 seconds
        if (store.length > 0 && (now - store[store.length - 1].t) < 30000) {
            store[store.length - 1] = snap;
        } else {
            store.push(snap);
        }

        // Retain rolling history of 300 snapshots
        if (store.length > 300) store.splice(0, store.length - 300);
        localStorage.setItem("sunchart_local_history_series", JSON.stringify(store));
    } catch (_) {}
}

// ─── Auto-refresh (60s interval) ──────────────────────────────────────────────
function startAutoRefresh(intervalMs = 60000) {
    stopAutoRefresh();
    autoRefreshTimer = setInterval(() => fetchMarket(), intervalMs);
}
function stopAutoRefresh() {
    if (autoRefreshTimer !== null) { clearInterval(autoRefreshTimer); autoRefreshTimer = null; }
}

document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
        stopAutoRefresh();
    } else {
        fetchMarket();
        startAutoRefresh(60000);
    }
});

// Helper: Parse SFL prices from any API response structure
function parsePricesFromResponse(json) {
    const result = [];
    if (!json) return result;

    if (Array.isArray(json)) {
        return json.map(i => ({ name: i.name || i.item_name, price: parseFloat(i.price) })).filter(i => i.name && !isNaN(i.price));
    }
    if (Array.isArray(json.data)) {
        return json.data.map(i => ({ name: i.name || i.item_name, price: parseFloat(i.price) })).filter(i => i.name && !isNaN(i.price));
    }
    if (Array.isArray(json.prices)) {
        return json.prices.map(i => ({ name: i.name || i.item_name, price: parseFloat(i.price) })).filter(i => i.name && !isNaN(i.price));
    }

    const sourceObj = (json.data && json.data.p2p) || json.p2p || json.data || json;
    if (typeof sourceObj === "object" && sourceObj !== null) {
        for (const [name, price] of Object.entries(sourceObj)) {
            const numPrice = typeof price === "object" && price !== null ? parseFloat(price.price || price.value) : parseFloat(price);
            if (name && !isNaN(numPrice) && typeof name === "string") {
                result.push({ name, price: numPrice });
            }
        }
    }
    return result;
}

// ─── Combined Market Fetch (with Direct Client Fallback) ───────────────────────
async function fetchMarket() {
    const refreshIcon  = document.getElementById("refreshIcon");
    const loadingState = document.getElementById("loadingState");
    const errorState   = document.getElementById("errorState");

    if (refreshIcon) refreshIcon.classList.add("fa-spin");

    let rawPrices = [];
    let moversData = { gainers: [], losers: [], changesMap: {} };

    try {
        // Step 1: Try our backend /api/market endpoint safely
        try {
            const res = await fetch("/api/market");
            if (res.ok) {
                const text = await res.text();
                try {
                    const data = JSON.parse(text);
                    if (data && Array.isArray(data.prices) && data.prices.length > 0) {
                        rawPrices = data.prices;
                        if (data.movers) moversData = data.movers;
                    }
                } catch (_) {
                    console.warn("[fetchMarket] /api/market returned non-JSON response.");
                }
            }
        } catch (apiErr) {
            console.warn("[fetchMarket] Backend /api/market unreachable:", apiErr.message);
        }

        // Step 2: If backend returned empty or was redirected by SSO, fetch directly from sfl.world
        if (!rawPrices || rawPrices.length === 0) {
            console.log("[fetchMarket] Fetching directly from sfl.world API...");
            const sflRes = await fetch("https://sfl.world/api/v1/prices");
            if (sflRes.ok) {
                const sflData = await sflRes.json();
                rawPrices = parsePricesFromResponse(sflData);
            }
        }

        if (!rawPrices || rawPrices.length === 0) {
            throw new Error("Unable to retrieve prices from market source.");
        }

        // Process prices
        allItems = rawPrices.map(item => ({
            name:  item.name  || item.item_name || "Unknown",
            price: parseFloat(item.price || 0),
        }));

        // Record time-series snapshot locally for instant history graphing
        recordLocalPriceHistory(allItems);

        // Compute client movers if backend movers are empty
        if (!moversData.gainers || (moversData.gainers.length === 0 && moversData.losers.length === 0)) {
            let pastMap = {};
            try {
                pastMap = JSON.parse(localStorage.getItem("sunchart_past_prices_cache") || "{}");
            } catch (_) {}

            const gainers = [];
            const losers  = [];
            const changesMap = {};

            allItems.forEach(item => {
                const lower = item.name.toLowerCase();
                const past = pastMap[lower] || item.price;
                const changeAmt = item.price - past;
                const changePct = past > 0 ? parseFloat(((changeAmt / past) * 100).toFixed(2)) : 0;

                const moverItem = {
                    name: item.name,
                    price: item.price,
                    pastPrice: past,
                    changePct: changePct,
                    changeAmt: parseFloat(changeAmt.toFixed(8))
                };

                changesMap[lower] = moverItem;
                if (changePct >= 0) gainers.push(moverItem);
                else losers.push(moverItem);
            });

            gainers.sort((a, b) => b.changePct - a.changePct);
            losers.sort((a, b) => a.changePct - b.changePct);
            moversData = { gainers, losers, changesMap };

            // Save snapshot for next delta comparison
            try {
                const snapshot = {};
                allItems.forEach(i => { snapshot[i.name.toLowerCase()] = i.price; });
                localStorage.setItem("sunchart_past_prices_cache", JSON.stringify(snapshot));
            } catch (_) {}
        }

        movers12hMap = moversData.changesMap || {};
        const gainers = Array.isArray(moversData.gainers) ? moversData.gainers : [];
        const losers  = Array.isArray(moversData.losers)  ? moversData.losers  : [];

        loadingState?.classList.add("hidden");
        errorState?.classList.add("hidden");

        populateDropdown();
        renderMovers(gainers, losers);
        renderWatchlist();

        if (window.activeItem) {
            const fresh = allItems.find(i => i.name.toLowerCase() === window.activeItem.name.toLowerCase());
            if (fresh) selectItem(fresh, false);
        } else if (allItems.length > 0) {
            const savedName  = localStorage.getItem("sunchart_last_selected_item");
            const targetItem = (savedName && allItems.find(i => i.name.toLowerCase() === savedName.toLowerCase()))
                || allItems.find(i => i.name.toLowerCase() === "sunflower")
                || allItems[0];
            selectItem(targetItem, true);
        }

    } catch (err) {
        console.error("fetchMarket failed:", err);
        loadingState?.classList.add("hidden");
        if (errorState) {
            errorState.classList.remove("hidden");
            const msg = document.getElementById("errorMessage");
            if (msg) msg.innerText = err.message || "Failed to load market data.";
        }
    } finally {
        if (refreshIcon) refreshIcon.classList.remove("fa-spin");
    }
}

window.fetchPrices = fetchMarket;
window.fetchMovers = fetchMarket;
window.fetchMarket = fetchMarket;

// ─── Movers Renderer ──────────────────────────────────────────────────────────
function renderMovers(allGainers, allLosers) {
    _lastGainers = allGainers || [];
    _lastLosers  = allLosers || [];

    const gainersList = document.getElementById("gainersList");
    const losersList  = document.getElementById("losersList");
    const badge       = document.getElementById("moversCountBadge");

    const total = _lastGainers.length + _lastLosers.length;
    if (badge) {
        badge.innerText = total;
        badge.classList.toggle("hidden", total === 0);
    }

    const buildMoverRow = (item, isGainer) => {
        const isSignificant = Math.abs(item.changePct) >= 5;
        const colorPrefix = item.changePct > 0 ? "emerald" : (item.changePct < 0 ? "rose" : "amber");
        const sign = item.changePct > 0 ? "+" : "";

        return `
            <button data-action="mover-select" data-item-name="${escapeHtml(item.name)}"
                class="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-[#fbf8f2] dark:bg-black/40 hover:bg-[#ede3d1] dark:hover:bg-zinc-900 border ${isSignificant ? `border-${colorPrefix}-500/40 dark:border-${colorPrefix}-500/30` : `border-${colorPrefix}-600/15 dark:border-${colorPrefix}-500/10`} transition shadow-2xs active:scale-[0.98] cursor-pointer text-left">
                <div class="min-w-0 flex items-center gap-1.5">
                    <span class="w-1.5 h-1.5 rounded-full ${isSignificant ? `bg-${colorPrefix}-500 animate-pulse` : `bg-${colorPrefix}-700/60 dark:bg-${colorPrefix}-500/60`} shrink-0"></span>
                    <span class="text-xs font-black text-[#1f1710] dark:text-zinc-100 truncate">${escapeHtml(item.name)}</span>
                </div>
                <div class="flex items-center gap-2 shrink-0 ml-2">
                    <span class="text-[10px] font-mono font-bold text-[#423425] dark:text-zinc-400">${formatDisplayPrice(item.price)} SFL</span>
                    <span class="text-[10px] font-mono font-black text-${colorPrefix}-900 dark:text-${colorPrefix}-400 bg-${colorPrefix}-500/15 dark:bg-${colorPrefix}-500/10 px-1.5 py-0.5 rounded-md border border-${colorPrefix}-600/30 dark:border-${colorPrefix}-500/20">
                        ${sign}${parseFloat(item.changePct).toFixed(1)}%
                    </span>
                </div>
            </button>`;
    };

    if (gainersList) {
        gainersList.innerHTML = _lastGainers.length === 0
            ? `<span class="text-[11px] text-[#6d5e4d] dark:text-zinc-400 font-bold italic py-1">Market is stable (no gains)</span>`
            : _lastGainers.map(item => buildMoverRow(item, true)).join("");
    }

    if (losersList) {
        losersList.innerHTML = _lastLosers.length === 0
            ? `<span class="text-[11px] text-[#6d5e4d] dark:text-zinc-400 font-bold italic py-1">Market is stable (no drops)</span>`
            : _lastLosers.map(item => buildMoverRow(item, false)).join("");
    }
}

// ─── Calculator State ─────────────────────────────────────────────────────────
function saveItemCalcState(itemName, qty, buyPrice) {
    if (!itemName) return;
    try {
        const map = JSON.parse(localStorage.getItem("sunchart_calc_map") || "{}");
        map[itemName.toLowerCase()] = { qty, buyPrice };
        localStorage.setItem("sunchart_calc_map", JSON.stringify(map));
    } catch (_) {}
}
function loadItemCalcState(itemName) {
    if (!itemName) return { qty: 50, buyPrice: "" };
    try {
        const map = JSON.parse(localStorage.getItem("sunchart_calc_map") || "{}");
        return map[itemName.toLowerCase()] || { qty: 50, buyPrice: "" };
    } catch (_) { return { qty: 50, buyPrice: "" }; }
}

// ─── Tax Rate ─────────────────────────────────────────────────────────────────
function onTaxRateChange(val) {
    currentTaxRate = parseFloat(val) || 10.0;
    try { localStorage.setItem("sunchart_tax_rate", currentTaxRate.toString()); } catch (_) {}
    calculateCustomStack();
}
window.onTaxRateChange = onTaxRateChange;

function syncTaxSelectorUI() {
    const select = document.getElementById("taxRateSelect");
    if (select) select.value = currentTaxRate.toString();
}

// ─── Tab Switcher ─────────────────────────────────────────────────────────────
function switchTab(tab) {
    currentTab = tab;
    const INACTIVE = "py-1 rounded-lg transition text-[#6d5e4d] dark:text-zinc-400 hover:text-black dark:hover:text-white flex items-center justify-center gap-1";
    const ACTIVE   = "py-1 rounded-lg transition bg-[#fbf8f2] dark:bg-zinc-800 text-amber-900 dark:text-amber-400 shadow-xs flex items-center justify-center gap-1";
    ["movers", "chart", "watchlist"].forEach(t => {
        document.getElementById(`${t}TabContent`)?.classList.add("hidden");
        const btn = document.getElementById(`tabBtn-${t}`);
        if (btn) btn.className = INACTIVE;
    });
    document.getElementById(`${tab}TabContent`)?.classList.remove("hidden");
    const activeBtn = document.getElementById(`tabBtn-${tab}`);
    if (activeBtn) activeBtn.className = ACTIVE;
    if (tab === "chart" && window.renderChart && window.fullHistoryData?.length > 0) window.renderChart();
    if (tab === "watchlist") renderWatchlist();
}
window.switchTab = switchTab;

// ─── Watchlist ────────────────────────────────────────────────────────────────
function saveWatchlist() {
    try { localStorage.setItem("sunchart_watchlist", JSON.stringify(watchlist)); } catch (_) {}
    updateWatchlistBadge();
    updateActiveItemStar();
    renderWatchlist();
}
function updateWatchlistBadge() {
    const badge = document.getElementById("watchlistCountBadge");
    if (!badge) return;
    badge.innerText = watchlist.length;
    badge.classList.toggle("hidden", watchlist.length === 0);
}
function toggleWatchlist(itemName) {
    if (!itemName) return;
    const idx = watchlist.findIndex(n => n.toLowerCase() === itemName.toLowerCase());
    if (idx >= 0) watchlist.splice(idx, 1);
    else watchlist.push(itemName);
    saveWatchlist();
}
window.toggleWatchlist = toggleWatchlist;
function toggleActiveItemWatchlist() {
    if (!window.activeItem) return;
    toggleWatchlist(window.activeItem.name);
}
window.toggleActiveItemWatchlist = toggleActiveItemWatchlist;

function updateActiveItemStar() {
    const starBtn  = document.getElementById("watchlistStarBtn");
    const starIcon = document.getElementById("watchlistStarIcon");
    if (!starBtn || !starIcon || !window.activeItem) return;
    const isWatched = watchlist.some(n => n.toLowerCase() === window.activeItem.name.toLowerCase());
    if (isWatched) {
        starBtn.className  = "w-7 h-7 rounded-xl flex items-center justify-center transition active:scale-90 bg-amber-500/20 text-amber-800 dark:text-amber-500 border border-amber-600/30";
        starIcon.className = "fa-solid fa-star text-xs text-amber-800 dark:text-amber-500";
    } else {
        starBtn.className  = "w-7 h-7 rounded-xl flex items-center justify-center transition active:scale-90 bg-[#ede3d1] dark:bg-white/5 hover:bg-amber-500/20 border border-[#cbbeaa] dark:border-transparent text-[#6d5e4d] dark:text-zinc-400 hover:text-amber-800";
        starIcon.className = "fa-regular fa-star text-xs";
    }
}

function renderWatchlist() {
    const grid = document.getElementById("watchlistGrid");
    if (!grid) return;
    if (watchlist.length === 0) {
        grid.innerHTML = `
            <div class="text-center py-8 space-y-1.5">
                <div class="w-8 h-8 rounded-full bg-amber-500/20 text-amber-800 dark:text-amber-500 flex items-center justify-center mx-auto text-xs">
                    <i class="fa-regular fa-star"></i>
                </div>
                <p class="text-xs font-black text-[#1f1710] dark:text-zinc-300">Watchlist is Empty</p>
                <p class="text-[10px] text-[#6d5e4d] dark:text-zinc-400 font-medium max-w-xs mx-auto">Tap the ★ icon on any resource to track it here.</p>
            </div>`;
        return;
    }
    grid.innerHTML = watchlist.map(name => {
        const item      = allItems.find(i => i.name.toLowerCase() === name.toLowerCase()) || { name, price: 0 };
        const moverData = movers12hMap[name.toLowerCase()];
        const safeName  = escapeHtml(item.name);
        let changeBadge = "";
        if (moverData && typeof moverData.changePct === "number") {
            const pct = moverData.changePct;
            if (pct > 0.001)
                changeBadge = `<span class="text-[9px] font-mono font-black text-emerald-900 dark:text-emerald-400 bg-emerald-500/15 dark:bg-emerald-500/10 px-1.5 py-0.5 rounded-md border border-emerald-600/30 dark:border-emerald-500/20">+${pct.toFixed(1)}%</span>`;
            else if (pct < -0.001)
                changeBadge = `<span class="text-[9px] font-mono font-black text-rose-900 dark:text-rose-400 bg-rose-500/15 dark:bg-rose-500/10 px-1.5 py-0.5 rounded-md border border-rose-600/30 dark:border-rose-500/20">${pct.toFixed(1)}%</span>`;
            else
                changeBadge = `<span class="text-[9px] font-mono font-bold text-[#5c4d3d] dark:text-zinc-400 bg-[#ede3d1] dark:bg-white/5 border border-[#cbbeaa] dark:border-transparent px-1.5 py-0.5 rounded-md">0.0%</span>`;
        } else {
            changeBadge = `<span class="text-[9px] font-mono font-bold text-[#5c4d3d] dark:text-zinc-400 bg-[#ede3d1] dark:bg-white/5 border border-[#cbbeaa] dark:border-transparent px-1.5 py-0.5 rounded-md">--</span>`;
        }
        return `
            <div class="w-full flex items-center justify-between px-3 py-2 rounded-xl bg-[#ede3d1] dark:bg-black/40 hover:bg-[#e4d8c2] dark:hover:bg-zinc-900 border border-[#cbbeaa] dark:border-white/10 transition shadow-2xs group">
                <div data-action="select" data-item-name="${safeName}" class="flex-1 min-w-0 flex items-center gap-2 cursor-pointer">
                    <span class="w-1.5 h-1.5 rounded-full bg-amber-600 dark:bg-amber-500 shrink-0"></span>
                    <span class="text-xs font-black text-[#1f1710] dark:text-zinc-100 truncate">${safeName}</span>
                </div>
                <div class="flex items-center gap-2.5 shrink-0 ml-2">
                    ${changeBadge}
                    <div data-action="select" data-item-name="${safeName}" class="text-right cursor-pointer min-w-[55px]">
                        <span class="text-xs font-mono font-black text-amber-900 dark:text-amber-400">${formatDisplayPrice(item.price)}</span>
                        <span class="text-[8px] font-bold text-[#6d5e4d] dark:text-zinc-400">SFL</span>
                    </div>
                    <button data-action="remove" data-item-name="${safeName}" title="Remove from Watchlist"
                        class="w-6 h-6 rounded-lg flex items-center justify-center bg-[#fbf8f2] dark:bg-white/5 hover:bg-rose-500/20 text-[#6d5e4d] hover:text-rose-700 border border-[#cbbeaa] dark:border-transparent transition active:scale-90">
                        <i class="fa-solid fa-xmark text-[11px]"></i>
                    </button>
                </div>
            </div>`;
    }).join("");
}

// Delegation for clicks
document.addEventListener("click", e => {
    const el     = e.target.closest("[data-action]");
    if (!el) return;
    const name   = el.dataset.itemName;
    const action = el.dataset.action;
    if (!name) return;
    if (action === "select" || action === "mover-select") onMoverSelect(name);
    if (action === "remove") toggleWatchlist(name);
});

// ─── Dropdown / Search ────────────────────────────────────────────────────────
function populateDropdown() {
    const dropdown = document.getElementById("itemDropdown");
    if (!dropdown || !Array.isArray(allItems)) return;
    const currentVal = dropdown.value;
    dropdown.innerHTML = '<option value="">Catalog ▾</option>';
    [...allItems].sort((a, b) => a.name.localeCompare(b.name)).forEach(item => {
        const opt = document.createElement("option");
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
        const si = document.getElementById("searchInput");
        if (si) si.value = item.name;
        switchTab("chart");
        selectItem(item, true);
    }
}

function handleSearchInput(query) {
    const list = document.getElementById("autocompleteList");
    if (!list || !Array.isArray(allItems)) return;
    if (!query?.trim()) { list.classList.add("hidden"); return; }
    const q       = query.toLowerCase().trim();
    const matches = allItems.filter(i => i.name.toLowerCase().includes(q)).slice(0, 6);
    list.innerHTML = matches.length === 0
        ? '<div class="p-3 text-xs text-[#6d5e4d] text-center font-bold">No assets found</div>'
        : matches.map(m => `
            <div data-action="autocomplete" data-item-name="${escapeHtml(m.name)}"
                class="px-3.5 py-2 text-xs font-bold hover:bg-[#ede3d1] dark:hover:bg-white/5 cursor-pointer flex items-center justify-between transition">
                <span class="text-[#1f1710] dark:text-white font-extrabold">${escapeHtml(m.name)}</span>
                <span class="font-mono text-amber-900 dark:text-amber-400 font-bold">${formatDisplayPrice(m.price)} SFL</span>
            </div>`).join("");
    list.classList.remove("hidden");
}

function showAutocomplete() {
    const si = document.getElementById("searchInput");
    if (si?.value.trim()) handleSearchInput(si.value);
}

document.addEventListener("click", e => {
    const list = document.getElementById("autocompleteList");
    const search = document.getElementById("searchInput");
    const acEl = e.target.closest("[data-action='autocomplete']");
    if (acEl) {
        const item = allItems.find(i => i.name.toLowerCase() === acEl.dataset.itemName.toLowerCase());
        if (item) {
            if (search) search.value = item.name;
            const dd = document.getElementById("itemDropdown");
            if (dd) dd.value = item.name;
            list?.classList.add("hidden");
            switchTab("chart");
            selectItem(item, true);
        }
        return;
    }
    if (list && search && !list.contains(e.target) && e.target !== search) list.classList.add("hidden");
});

function onMoverSelect(itemName) {
    if (!itemName) return;
    const item = allItems.find(i => i.name.toLowerCase() === itemName.toLowerCase()) || { name: itemName, price: 0 };
    const dd = document.getElementById("itemDropdown");
    const si = document.getElementById("searchInput");
    if (dd) dd.value = item.name;
    if (si) si.value = item.name;
    switchTab("chart");
    selectItem(item, true);
}

// ─── Item Selection ───────────────────────────────────────────────────────────
function selectItem(item, loadGraph = true) {
    window.activeItem = item;
    try { localStorage.setItem("sunchart_last_selected_item", item.name); } catch (_) {}

    document.getElementById("emptyState")?.classList.add("hidden");
    document.getElementById("itemDetailsContainer")?.classList.remove("hidden");

    const price = parseFloat(item.price) || 0;
    const ids   = { selectedItemName: item.name, selectedItemPrice: formatDisplayPrice(price),
                    stack10Price: formatDisplayPrice(price * 10), stack100Price: formatDisplayPrice(price * 100),
                    stack1000Price: formatDisplayPrice(price * 1000) };
    Object.entries(ids).forEach(([id, val]) => { const el = document.getElementById(id); if (el) el.innerText = val; });

    const saved    = loadItemCalcState(item.name);
    const qtyInput = document.getElementById("calcQuantity");
    const buyInput = document.getElementById("calcBuyPrice");
    if (qtyInput) qtyInput.value = saved.qty || 50;
    if (buyInput) buyInput.value = (saved.buyPrice != null && saved.buyPrice !== "") ? saved.buyPrice : "";

    updateActiveItemStar();
    calculateCustomStack(false);
    if (loadGraph && typeof window.loadItemHistoryGraph === "function") window.loadItemHistoryGraph(item.name);
}

// ─── Calculator ───────────────────────────────────────────────────────────────
function setQuantity(val) {
    const q = document.getElementById("calcQuantity");
    if (q) { q.value = Math.max(1, parseInt(val) || 1); calculateCustomStack(); }
}
window.setQuantity = setQuantity;

function addQuantity(amount) {
    const q = document.getElementById("calcQuantity");
    if (q) { q.value = Math.max(1, (parseInt(q.value) || 0) + amount); calculateCustomStack(); }
}
window.addQuantity = addQuantity;

function calculateCustomStack(shouldSave = true) {
    const qtyInput  = document.getElementById("calcQuantity");
    const buyInput  = document.getElementById("calcBuyPrice");
    const grossEl   = document.getElementById("calcGross");
    if (!qtyInput || !grossEl || !window.activeItem) return;

    const qty          = Math.max(1, parseFloat(qtyInput.value) || 1);
    const currentPrice = parseFloat(window.activeItem.price) || 0;
    const buyPriceRaw  = buyInput ? buyInput.value : "";
    const buyPrice     = buyPriceRaw !== "" ? Math.max(0, parseFloat(buyPriceRaw) || 0) : 0;

    if (shouldSave && window.activeItem) saveItemCalcState(window.activeItem.name, qty, buyPriceRaw);

    const taxFrac   = currentTaxRate / 100.0;
    const gross     = qty * currentPrice;
    const fee       = gross * taxFrac;
    const netYield  = gross - fee;
    const totalCost = qty * buyPrice;
    const profit    = netYield - totalCost;
    const netMult   = 1.0 - taxFrac;

    const set = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val; };
    set("calcGross", formatDisplayPrice(gross));
    set("calcFeeLabel", `Plaza Tax (-${currentTaxRate}%)`);
    set("calcFee", `-${formatDisplayPrice(fee)}`);
    set("calcCost", formatDisplayPrice(totalCost));

    if (buyPrice > 0 && netMult > 0) {
        set("target5Price",  `${formatDisplayPrice((buyPrice * 1.05) / netMult)} SFL`);
        set("target10Price", `${formatDisplayPrice((buyPrice * 1.10) / netMult)} SFL`);
        set("target5Label",  "+5% Profit Target:");
        set("target10Label", "+10% Profit Target:");
    } else {
        set("target5Price",  `${formatDisplayPrice(currentPrice * 1.05)} SFL`);
        set("target10Price", `${formatDisplayPrice(currentPrice * 1.10)} SFL`);
        set("target5Label",  "+5% Target:");
        set("target10Label", "+10% Target:");
    }

    const profitEl       = document.getElementById("calcProfit");
    const profitLabelEl  = document.getElementById("calcProfitLabel");
    const profitUnitEl   = document.getElementById("calcProfitUnit");
    if (profitEl) {
        profitEl.innerText = `${profit >= 0 ? "+" : ""}${formatDisplayPrice(profit)}`;
        const roi = totalCost > 0 ? ((profit / totalCost) * 100).toFixed(1) : 0;
        if (profit > 0.000001) {
            profitEl.className       = "font-mono font-black text-xs sm:text-sm text-emerald-900 dark:text-emerald-400";
            if (profitLabelEl) { profitLabelEl.className = "block font-black text-[8px] uppercase text-emerald-900 dark:text-emerald-400"; profitLabelEl.innerText = totalCost > 0 ? `Net Profit (+${roi}%)` : "Net Yield"; }
            if (profitUnitEl) profitUnitEl.className = "text-[8px] font-black text-emerald-900/80 dark:text-emerald-400/70";
        } else if (profit < -0.000001) {
            profitEl.className       = "font-mono font-black text-xs sm:text-sm text-rose-900 dark:text-rose-400";
            if (profitLabelEl) { profitLabelEl.className = "block font-black text-[8px] uppercase text-rose-900 dark:text-rose-400"; profitLabelEl.innerText = `Net Loss (${roi}%)`; }
            if (profitUnitEl) profitUnitEl.className = "text-[8px] font-black text-rose-900/80 dark:text-rose-400/70";
        } else {
            profitEl.className       = "font-mono font-black text-xs sm:text-sm text-[#423425] dark:text-zinc-400";
            if (profitLabelEl) { profitLabelEl.className = "block font-black text-[8px] uppercase text-[#6d5e4d] dark:text-zinc-400"; profitLabelEl.innerText = "Net Yield"; }
            if (profitUnitEl) profitUnitEl.className = "text-[8px] font-black text-[#6d5e4d] dark:text-zinc-400";
        }
    }
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener("DOMContentLoaded", () => {
    syncTaxSelectorUI();
    updateWatchlistBadge();
    switchTab("movers");

    fetchMarket();
    startAutoRefresh(60000);
});

// ─── Global Exports ───────────────────────────────────────────────────────────
window.onMoverSelect        = onMoverSelect;
window.onDropdownSelect     = onDropdownSelect;
window.handleSearchInput    = handleSearchInput;
window.showAutocomplete     = showAutocomplete;
window.calculateCustomStack = calculateCustomStack;

export const MARKETPLACE_COLLECTIBLES_MAP = {
  // Plot Crops (24)
  "collectibles-201": "Sunflower",
  "collectibles-202": "Potato",
  "collectibles-258": "Rhubarb",
  "collectibles-203": "Pumpkin",
  "collectibles-259": "Zucchini",
  "collectibles-204": "Carrot",
  "collectibles-260": "Yam",
  "collectibles-205": "Cabbage",
  "collectibles-261": "Broccoli",
  "collectibles-251": "Soybean",
  "collectibles-206": "Beetroot",
  "collectibles-262": "Pepper",
  "collectibles-207": "Cauliflower",
  "collectibles-208": "Parsnip",
  "collectibles-215": "Eggplant",
  "collectibles-216": "Corn",
  "collectibles-263": "Onion",
  "collectibles-209": "Radish",
  "collectibles-210": "Wheat",
  "collectibles-264": "Turnip",
  "collectibles-211": "Kale",
  "collectibles-265": "Artichoke",
  "collectibles-257": "Barley",
  "collectibles-3027": "Saltwort",

  // Fruits (9)
  "collectibles-255": "Tomato",
  "collectibles-256": "Lemon",
  "collectibles-213": "Blueberry",
  "collectibles-214": "Orange",
  "collectibles-212": "Apple",
  "collectibles-217": "Banana",
  "collectibles-268": "Celestine",
  "collectibles-267": "Lunara",
  "collectibles-266": "Duskberry",

  // Greenhouse Crops (3)
  "collectibles-252": "Grape",
  "collectibles-253": "Rice",
  "collectibles-254": "Olive",

  // Mining Resources (7)
  "collectibles-601": "Wood",
  "collectibles-602": "Stone",
  "collectibles-603": "Iron",
  "collectibles-604": "Gold",
  "collectibles-636": "Crimstone",
  "collectibles-665": "Salt",
  "collectibles-663": "Obsidian",
};

export function parseSflWorldPrices(json) {
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

  const sourceObj = (json.data && json.data.p2p) || (json.p2p) || (json.data) || json;
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

/**
 * Fetches market prices from official Sunflower Land Community API if key provided, with sfl.world fallback
 * @param {string} [apiKey]
 * @returns {Promise<Array<{name: string, price: number}>>}
 */
export async function fetchLiveMarketPrices(apiKey = (process.env.SFL_COMMUNITY_API_KEY || process.env.SFL_API_KEY)) {
  if (apiKey) {
    try {
      const url = "https://api.sunflower-land.com/community/data?type=marketplaceActivity";
      const res = await fetch(url, {
        headers: {
          "x-api-key": apiKey.trim(),
          "Accept": "application/json",
          "User-Agent": "SunChart/1.0"
        }
      });

      if (res.ok) {
        const json = await res.json();
        const reports = json.data?.reports || {};
        const dates = Object.keys(reports).sort();
        if (dates.length > 0) {
          const latestReport = reports[dates[dates.length - 1]];
          const items = latestReport.items || {};
          const prices = [];

          for (const [colId, itemName] of Object.entries(MARKETPLACE_COLLECTIBLES_MAP)) {
            const itemData = items[colId];
            if (itemData) {
              const unitPrice = itemData.floor !== undefined && itemData.floor !== null
                ? parseFloat(itemData.floor)
                : (itemData.latestSale !== undefined && itemData.latestSale !== null ? parseFloat(itemData.latestSale) : null);

              if (unitPrice !== null && !isNaN(unitPrice) && unitPrice > 0) {
                prices.push({
                  name: itemName,
                  price: unitPrice
                });
              }
            }
          }

          if (prices.length > 0) {
            console.log(`[collectibles] Successfully loaded ${prices.length} items from official Sunflower Land API`);
            return prices;
          }
        }
      } else {
        console.warn(`[collectibles] Official API returned status ${res.status}, falling back to sfl.world`);
      }
    } catch (err) {
      console.warn("[collectibles] Official API fetch failed, falling back to sfl.world:", err.message);
    }
  }

  // Fallback: sfl.world
  try {
    const sflRes = await fetch("https://sfl.world/api/v1/prices", {
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; SunChart/1.0; +https://sunchart.app)",
        "Accept": "application/json"
      }
    });
    if (sflRes.ok) {
      const data = await sflRes.json();
      return parseSflWorldPrices(data);
    }
  } catch (err) {
    console.error("[collectibles] Fallback sfl.world error:", err.message);
  }

  return [];
}

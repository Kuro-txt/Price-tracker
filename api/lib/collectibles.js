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

  // Animal Resources (2)
  "collectibles-605": "Egg",
  "collectibles-614": "Honey",
};

const DEFAULT_API_KEY = "sfl.ODQ3Mjg4MzcwNjQwMzkxNA.v4YoA_Owx6hbEti3N0xcgEIFjPa1qvtXURVO013TYD4";

/**
 * Fetches market prices exclusively from the official Sunflower Land Marketplace Activity API
 * @param {string} [apiKey]
 * @returns {Promise<Array<{name: string, price: number}>>}
 */
export async function fetchLiveMarketPrices(apiKey = (process.env.SFL_COMMUNITY_API_KEY || process.env.SFL_API_KEY || DEFAULT_API_KEY)) {
  const key = (apiKey || "").trim();
  if (!key) {
    throw new Error("Missing Sunflower Land Community API key.");
  }

  const url = "https://api.sunflower-land.com/community/data?type=marketplaceActivity";
  const res = await fetch(url, {
    headers: {
      "x-api-key": key,
      "Accept": "application/json",
      "User-Agent": "SunChart/1.0"
    }
  });

  if (!res.ok) {
    const errorText = await res.text().catch(() => "");
    throw new Error(`Sunflower Land API error ${res.status}: ${errorText}`);
  }

  const json = await res.json();
  const reports = json.data?.reports || {};
  const dates = Object.keys(reports).sort();

  if (dates.length === 0) {
    throw new Error("Sunflower Land API returned empty reports data.");
  }

  const latestReport = reports[dates[dates.length - 1]];
  const items = latestReport.items || {};
  const prices = [];

  for (const [colId, itemName] of Object.entries(MARKETPLACE_COLLECTIBLES_MAP)) {
    const itemData = items[colId];
    if (itemData) {
      // Prioritize active floor price; fallback to latestSale
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

  if (prices.length === 0) {
    throw new Error("No valid resource prices mapped from Sunflower Land API response.");
  }

  return prices;
}

export default async function handler(req, res) {
  try {
    const response = await fetch("https://sfl.world/api/v1/prices", {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
        "Accept": "application/json",
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({ error: "SFL API failed" });
    }

    const data = await response.json();
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Cache-Control", "s-maxage=15, stale-while-revalidate");
    return res.status(200).json(data);
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}

"use client";

import { useEffect, useState } from "react";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from "chart.js";
import { Line } from "react-chartjs-2";
import { RefreshCw, TrendingUp, Search } from "lucide-react";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

export default function TrackerDashboard() {
  const [items, setItems] = useState([]);
  const [selectedItem, setSelectedItem] = useState(null);
  const [history, setHistory] = useState([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [chartLoading, setChartLoading] = useState(false);

  // Load latest prices
  const loadLatest = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/history");
      const data = await res.json();
      if (Array.isArray(data)) {
        setItems(data);
        if (data.length > 0 && !selectedItem) {
          selectResource(data[0].item_name);
        }
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  // Load chart history for selected resource
  const selectResource = async (name) => {
    setSelectedItem(name);
    setChartLoading(true);
    try {
      const res = await fetch(`/api/history?item=${encodeURIComponent(name)}&limit=50`);
      const data = await res.json();
      setHistory(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error(err);
    } finally {
      setChartLoading(false);
    }
  };

  useEffect(() => {
    loadLatest();
  }, []);

  const filteredItems = items.filter((i) =>
    i.item_name.toLowerCase().includes(search.toLowerCase())
  );

  const chartData = {
    labels: history.map((h) => new Date(h.recorded_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })),
    datasets: [
      {
        label: `${selectedItem} Price (SFL)`,
        data: history.map((h) => h.price),
        borderColor: "#10b981",
        backgroundColor: "rgba(16, 185, 129, 0.1)",
        fill: true,
        tension: 0.35,
      },
    ],
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-8">
      <div className="max-w-7xl mx-auto space-y-6">
        
        {/* Header */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 bg-slate-900 border border-slate-800 p-6 rounded-2xl">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <TrendingUp className="text-emerald-400" /> SFL Price Tracker
            </h1>
            <p className="text-slate-400 text-sm mt-1">Live snapshots & historical trends stored in Turso</p>
          </div>
          <button
            onClick={loadLatest}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-500 text-white px-4 py-2 rounded-xl text-sm font-medium transition"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Refresh
          </button>
        </div>

        {/* Main Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          
          {/* Left Column: Resource List */}
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-2.5 text-slate-500" size={18} />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search resource..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl pl-10 pr-4 py-2 text-sm focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="max-h-[600px] overflow-y-auto space-y-2 pr-1">
              {filteredItems.map((item) => (
                <button
                  key={item.item_name}
                  onClick={() => selectResource(item.item_name)}
                  className={`w-full flex justify-between items-center p-3 rounded-xl border text-sm transition ${
                    selectedItem === item.item_name
                      ? "bg-emerald-950/40 border-emerald-500 text-emerald-300"
                      : "bg-slate-950/50 border-slate-800/80 hover:border-slate-700 text-slate-300"
                  }`}
                >
                  <span className="font-medium">{item.item_name}</span>
                  <span className="font-mono text-emerald-400 font-semibold">{Number(item.price).toFixed(4)} SFL</span>
                </button>
              ))}
              {filteredItems.length === 0 && (
                <p className="text-center text-slate-500 text-xs py-8">No records yet. Run the cron job once to populate.</p>
              )}
            </div>
          </div>

          {/* Right Column: Chart View */}
          <div className="lg:col-span-2 bg-slate-900 border border-slate-800 rounded-2xl p-6 flex flex-col justify-between">
            <div>
              <h2 className="text-lg font-semibold text-slate-200 mb-1">
                {selectedItem ? `${selectedItem} Historical Trend` : "Select a resource"}
              </h2>
              <p className="text-xs text-slate-500">Showing recent recorded price points</p>
            </div>

            <div className="my-6 min-h-[350px] flex items-center justify-center">
              {chartLoading ? (
                <RefreshCw className="animate-spin text-emerald-500" size={32} />
              ) : history.length > 1 ? (
                <div className="w-full h-80">
                  <Line
                    data={chartData}
                    options={{
                      responsive: true,
                      maintainAspectRatio: false,
                      plugins: { legend: { display: false } },
                      scales: {
                        x: { grid: { color: "#1e293b" } },
                        y: { grid: { color: "#1e293b" } },
                      },
                    }}
                  />
                </div>
              ) : (
                <p className="text-slate-500 text-sm text-center">
                  Need at least 2 recorded snapshots to draw a trendline.<br />
                  <span className="text-xs text-slate-600 mt-1 block">Trigger the cron endpoint periodically to build history.</span>
                </p>
              )}
            </div>

            <div className="text-xs text-slate-500 border-t border-slate-800 pt-4 flex justify-between">
              <span>Data Source: sfl.world</span>
              <span>Backend: Turso SQLite</span>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

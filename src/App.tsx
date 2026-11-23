import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { downloadDir, join } from "@tauri-apps/api/path";
import "./App.css";
import ReactMarkdown from "react-markdown";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";

// ============================================================
// TYPES
// ============================================================
interface Vitals {
  current_balance: number;
  days_of_runway: number;
  current_floor: number;
  survival_floor_amount: number;
  cycle_label: string;
  total_income: number;
  total_expense: number;
  net_position: number;
}

interface BucketHealth {
  id: number;
  name: string;
  liquidity: string;
  necessity_tier: string;
  allocated: number;
  current_balance: number;
  spent_this_cycle: number;
  remaining: number;
  pct_used: number;
}

interface Transaction {
  id: number;
  type: string;
  amount: number;
  date: string;
  category: string;
  subcategory: string | null;
  necessity_tier: string;
  was_planned: boolean;
  emotional_state: string | null;
  description: string | null;
  bucket_name: string | null;
  source_name: string | null;
}

type Screen = "dashboard" | "add" | "buckets" | "transactions" | "floor" | "ai" | "cycles" | "settings" | "networth" | "savings" | "identity" | "compare" | "export" | "backup" | "scenario" | "letter" | "mpc" | "habits" | "ghosts" | "archaeology" | "memory" | "reliability" | "patterns" | "planning" | "sealed" | "emergency" | "loans";

// ============================================================
// HELPERS
// ============================================================
const fmt = (n: number) => {
  if (n % 1 === 0) return "₹" + n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
  return "₹" + n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const floorLabel = (f: number) =>
  ["", "Survival", "Stability", "Growth", "Wealth"][f] ?? "Unknown";

const floorColor = (f: number) =>
  ["", "text-red-400", "text-yellow-400", "text-blue-400", "text-green-400"][f] ?? "text-gray-400";

const tierColor: Record<string, string> = {
  survival: "bg-red-500/20 text-red-300",
  comfort: "bg-blue-500/20 text-blue-300",
  aspiration: "bg-purple-500/20 text-purple-300",
  investment: "bg-green-500/20 text-green-300",
};

// ============================================================
// VITALS STRIP — always visible at top
// ============================================================
function VitalsStrip({ vitals }: { vitals: Vitals | null }) {
  if (!vitals) return (
    <div className="h-14 border-b flex items-center px-4 gap-6" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
      <span className="text-zinc-500 text-sm">Loading vitals...</span>
    </div>
  );

  return (
    <div className="h-14 bg-zinc-900 border-b border-zinc-800 flex items-center px-4 gap-6">
      <div className="flex flex-col">
        <span className="text-xs text-zinc-500">Balance</span>
        <span className={`text-sm font-semibold ${vitals.current_balance >= 0 ? "text-white" : "text-red-400"}`}>
          {fmt(vitals.current_balance)}
        </span>
      </div>
      <div className="w-px h-8 bg-zinc-800" />
      <div className="flex flex-col">
        <span className="text-xs text-zinc-500">Runway</span>
        <span className="text-sm font-semibold text-white">
          {vitals.days_of_runway.toFixed(0)} days
        </span>
      </div>
      <div className="w-px h-8 bg-zinc-800" />
      <div className="flex flex-col">
        <span className="text-xs text-zinc-500">Floor</span>
        <span className={`text-sm font-semibold ${floorColor(vitals.current_floor)}`}>
          {floorLabel(vitals.current_floor)}
        </span>
      </div>
      <div className="flex-1" />
      <span className="text-xs text-zinc-600">{vitals.cycle_label}</span>
    </div>
  );
}

// ============================================================
// DASHBOARD — floor-gated adaptive interface (Simon)
// ============================================================
function Dashboard({ vitals, buckets, setScreen }: {
  vitals: Vitals | null;
  buckets: BucketHealth[];
  setScreen: (s: Screen) => void;
}) {
  if (!vitals) return <div className="p-4 text-sm" style={{color:'var(--muted)'}}>Loading...</div>;
  const [insight, setInsight] = useState<any>(null);
  const [loadingInsight, setLoadingInsight] = useState(false);
  const [insightDismissed, setInsightDismissed] = useState(false);

  const fetchInsight = async () => {
  setLoadingInsight(true);
  try {
    const result = await invoke<any>("generate_insight");
    setInsight(result);
    setInsightDismissed(false);
  } catch {}
  finally { setLoadingInsight(false); }
};

  const floor = vitals.current_floor;

  return (
    <div className="p-4 space-y-4">

      {/* Contextual insight card */}
{!insightDismissed && (
  <div className="rounded-xl border overflow-hidden"
    style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
    {insight ? (
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1">
            <p className="text-xs text-blue-400 uppercase tracking-wider mb-1">
              AI insight
            </p>
            <p className="text-sm font-medium" style={{color:'var(--text)'}}>
              {insight.title}
            </p>
            <p className="text-xs mt-1" style={{color:'var(--muted)'}}>
              {insight.body}
            </p>
          </div>
          <button
            onClick={() => setInsightDismissed(true)}
            className="text-xs flex-shrink-0 mt-0.5"
            style={{color:'var(--muted)'}}
          >✕</button>
        </div>
      </div>
    ) : (
      <button
        onClick={fetchInsight}
        disabled={loadingInsight}
        className="w-full px-4 py-3 text-left flex items-center gap-2 transition-all hover:opacity-80"
      >
        {loadingInsight ? (
          <>
            {[0,150,300].map((d) => (
              <div key={d} className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce"
                style={{animationDelay:`${d}ms`}} />
            ))}
            <span className="text-xs" style={{color:'var(--muted)'}}>Generating insight...</span>
          </>
        ) : (
          <>
            <span className="text-blue-400">◈</span>
            <span className="text-xs" style={{color:'var(--muted)'}}>
              Get today's AI insight
            </span>
          </>
        )}
      </button>
    )}
  </div>
)}

      {/* FLOOR 1: Survival — show only the three most critical things */}
      {floor === 1 && (
        <div className="rounded-xl p-4 border border-red-500/30"
          style={{background:'rgba(239,68,68,0.05)'}}>
          <p className="text-xs text-red-400 uppercase tracking-wider mb-3">⚠ Survival floor — focus on essentials</p>
          <div className="space-y-3">
            <div className="rounded-lg p-3" style={{background:'var(--bg3)'}}>
              <p className="text-xs" style={{color:'var(--muted)'}}>Current balance</p>
              <p className={`text-2xl font-semibold ${vitals.current_balance >= 0 ? "text-white" : "text-red-400"}`}>
                {fmt(vitals.current_balance)}
              </p>
            </div>
            <div className="rounded-lg p-3" style={{background:'var(--bg3)'}}>
              <p className="text-xs" style={{color:'var(--muted)'}}>Days of runway</p>
              <p className="text-2xl font-semibold text-white">{vitals.days_of_runway.toFixed(0)} days</p>
            </div>
            <div className="rounded-lg p-3" style={{background:'var(--bg3)'}}>
              <p className="text-xs" style={{color:'var(--muted)'}}>Survival floor</p>
              <p className="text-lg font-semibold text-red-400">{fmt(vitals.survival_floor_amount)}/mo</p>
            </div>
          </div>
          <p className="text-xs mt-3" style={{color:'var(--muted)'}}>
            Set your survival floor in Floor radar to unlock more features.
          </p>
        </div>
      )}

      {/* FLOOR 2+: Stability — show cycle summary */}
      {floor >= 2 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl p-3 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
            <p className="text-xs" style={{color:'var(--muted)'}}>Income</p>
            <p className="text-lg font-semibold text-green-400">{fmt(vitals.total_income)}</p>
          </div>
          <div className="rounded-xl p-3 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
            <p className="text-xs" style={{color:'var(--muted)'}}>Spent</p>
            <p className="text-lg font-semibold text-red-400">{fmt(vitals.total_expense)}</p>
          </div>
          <div className="rounded-xl p-3 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
            <p className="text-xs" style={{color:'var(--muted)'}}>Net this cycle</p>
            <p className={`text-lg font-semibold ${vitals.net_position >= 0 ? "text-blue-400" : "text-red-400"}`}>
              {fmt(vitals.net_position)}
            </p>
          </div>
        </div>
      )}

      {/* FLOOR 2+: Survival floor strip */}
      {floor >= 2 && vitals.survival_floor_amount > 0 && (
        <div className="rounded-xl p-3 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
          <div className="flex justify-between items-center">
            <span className="text-xs" style={{color:'var(--muted)'}}>Survival floor coverage</span>
            <span className="text-xs" style={{color:'var(--muted)'}}>{fmt(vitals.survival_floor_amount)}/mo</span>
          </div>
          <p className="text-sm text-white mt-1">{vitals.days_of_runway.toFixed(0)} days of runway at current balance</p>
        </div>
      )}

      {/* FLOOR 2+: Buckets */}
      {floor >= 2 && (
        <div>
          <p className="text-xs uppercase tracking-wider mb-2" style={{color:'var(--muted)'}}>Buckets</p>
          {buckets.length === 0 ? (
            <div className="rounded-xl p-4 border text-center" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
              <p className="text-sm" style={{color:'var(--muted)'}}>No buckets yet.</p>
              <button onClick={() => setScreen("buckets")}
                className="mt-2 text-xs text-blue-400 hover:text-blue-300">
                + Create your first bucket →
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {buckets.map((b) => (
                <div key={b.id} className="rounded-xl p-3 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
                  <div className="flex justify-between items-center mb-2">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium" style={{color:'var(--text)'}}>{b.name}</span>
                      {b.liquidity === "locked" && (
                        <span className="text-xs px-1.5 py-0.5 rounded" style={{background:'var(--bg3)', color:'var(--muted)'}}>locked</span>
                      )}
                    </div>
                    <span className="text-xs" style={{color:'var(--muted)'}}>{fmt(b.remaining)} left</span>
                  </div>
                  <div className="w-full rounded-full h-1.5" style={{background:'var(--bg3)'}}>
                    <div className={`h-1.5 rounded-full transition-all ${
                      b.pct_used > 90 ? "bg-red-500" : b.pct_used > 70 ? "bg-yellow-500" : "bg-blue-500"
                    }`} style={{width:`${Math.min(b.pct_used, 100)}%`}} />
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-xs" style={{color:'var(--muted)'}}>{fmt(b.spent_this_cycle)} spent</span>
                    <span className="text-xs" style={{color:'var(--muted)'}}>{fmt(b.allocated)} allocated</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* FLOOR 3+: Growth features unlocked */}
      {floor >= 3 && (
        <div className="rounded-xl p-3 border border-blue-500/20"
          style={{background:'rgba(59,130,246,0.05)'}}>
          <p className="text-xs text-blue-400 uppercase tracking-wider mb-2">Growth floor unlocked</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { id: "networth", label: "Net worth curve", icon: "∿" },
              { id: "identity", label: "Identity card", icon: "◉" },
              { id: "scenario", label: "Simulator", icon: "⟳" },
              { id: "habits", label: "Habit tracker", icon: "◐" },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setScreen(item.id as Screen)}
                className="rounded-lg p-2.5 border text-left transition-all hover:border-blue-500/40"
                style={{background:'var(--bg2)', borderColor:'var(--border)'}}
              >
                <p className="text-sm mb-0.5">{item.icon}</p>
                <p className="text-xs font-medium" style={{color:'var(--text)'}}>{item.label}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* FLOOR 4: Wealth features */}
      {floor >= 4 && (
        <div className="rounded-xl p-3 border border-green-500/20"
          style={{background:'rgba(34,197,94,0.05)'}}>
          <p className="text-xs text-green-400 uppercase tracking-wider mb-2">Wealth floor unlocked</p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { id: "compare", label: "Compare cycles", icon: "⇄" },
              { id: "letter", label: "Weekly letter", icon: "✉" },
              { id: "mpc", label: "MPC trend", icon: "⟆" },
              { id: "savings", label: "Goals", icon: "◎" },
            ].map((item) => (
              <button
                key={item.id}
                onClick={() => setScreen(item.id as Screen)}
                className="rounded-lg p-2.5 border text-left transition-all hover:border-green-500/40"
                style={{background:'var(--bg2)', borderColor:'var(--border)'}}
              >
                <p className="text-sm mb-0.5">{item.icon}</p>
                <p className="text-xs font-medium" style={{color:'var(--text)'}}>{item.label}</p>
              </button>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

// ============================================================
// ADD TRANSACTION SCREEN
// ============================================================
function AddTransaction({
  buckets,
  onSuccess,
}: {
  buckets: BucketHealth[];
  onSuccess: () => void;
}) {
  const [type, setType] = useState<"income" | "expense">("expense");
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState("");
  const [tier, setTier] = useState("comfort");
  const [planned, setPlanned] = useState(true);
  const [bucketId, setBucketId] = useState<number | null>(null);
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [emergencyFlat, setEmergencyFlat] = useState("");
  const [emergencyPct, setEmergencyPct] = useState("");
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const expenseCategories = [
    "Food", "Transport", "Hostel", "Books & Courses",
    "Subscriptions", "Social", "Health", "Clothing",
    "Electronics", "Emergency", "Other"
  ];

  const incomeCategories = [
    "Pocket money", "Stipend", "Freelance",
    "Scholarship", "Gift", "Sale", "Other"
  ];

  const handleSubmit = async () => {
    if (!amount || !category) {
      setMsg("Amount and category are required.");
      return;
    }
    setLoading(true);
    try {
      if (type === "income") {
        await invoke("add_income_with_split", {
          amount: parseFloat(amount),
          date,
          category,
          description: description || null,
          emergencyFlat: emergencyFlat ? parseFloat(emergencyFlat) : null,
          emergencyPct: emergencyPct ? parseFloat(emergencyPct) : null,
        });
      } else {
        await invoke("add_transaction", {
          tx: {
            id: null,
            transaction_type: type,
            amount: parseFloat(amount),
            date,
            time: null,
            source_id: null,
            bucket_id: bucketId,
            category,
            subcategory: null,
            necessity_tier: tier,
            was_planned: planned,
            emotional_state: null,
            entry_method: "manual",
            is_split: false,
            split_parent_id: null,
            cycle_id: null,
            description: description || null,
            notes: null,
          },
        });
      }
      setMsg("✓ Logged");
      setAmount("");
      setCategory("");
      setDescription("");
      setEmergencyFlat("");
      setEmergencyPct("");
      setTimeout(() => { setMsg(""); onSuccess(); }, 800);
    } catch (e) {
      setMsg("Error: " + e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <p className="text-xs text-zinc-500 uppercase tracking-wider">Log a transaction</p>

      {/* Type toggle */}
      <div className="flex bg-zinc-900 rounded-xl p-1 border border-zinc-800">
        {(["expense", "income"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={`flex-1 py-2 rounded-lg text-sm font-medium transition-all ${
              type === t
                ? t === "expense" ? "bg-red-500/20 text-red-300" : "bg-green-500/20 text-green-300"
                : "text-zinc-500"
            }`}
          >
            {t === "expense" ? "Expense" : "Income"}
          </button>
        ))}
      </div>

      {/* Amount */}
      <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800">
        <label className="text-xs text-zinc-500 block mb-1">Amount (₹)</label>
        <input
          type="number"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
          placeholder="0"
          className="w-full bg-transparent text-2xl font-semibold text-white outline-none placeholder-zinc-700"
        />
      </div>
      {type === "income" && (
        <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800">
          <label className="text-xs text-zinc-500 block mb-1">Route to Emergency Fund (optional, defaults to none)</label>
          <div className="flex gap-2">
            <input type="number" value={emergencyFlat}
              onChange={(e) => { setEmergencyFlat(e.target.value); setEmergencyPct(""); }}
              placeholder="Flat amount (₹)"
              className="flex-1 rounded-lg px-2 py-1.5 text-sm outline-none bg-zinc-800 text-white" />
            <span className="text-xs text-zinc-500 self-center">or</span>
            <input type="number" value={emergencyPct}
              onChange={(e) => { setEmergencyPct(e.target.value); setEmergencyFlat(""); }}
              placeholder="% instead"
              className="flex-1 rounded-lg px-2 py-1.5 text-sm outline-none bg-zinc-800 text-white" />
          </div>
        </div>
      )}

      <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800">
        <label className="text-xs text-zinc-500 block mb-1">Date</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="w-full bg-transparent text-sm text-white outline-none"
        />
      </div>

      {/* Category */}
      <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800">
        <label className="text-xs text-zinc-500 block mb-2">
          {type === "expense" ? "Category" : "Income source"}
        </label>
        <div className="flex flex-wrap gap-2">
          {(type === "expense" ? expenseCategories : incomeCategories).map((c) => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                category === c
                  ? "bg-blue-500/20 border-blue-500/50 text-blue-300"
                  : "border-zinc-700 text-zinc-400 hover:border-zinc-600"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>

      {/* Necessity tier */}
      {type === "expense" && (
  <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800">
    <label className="text-xs text-zinc-500 block mb-1">Necessity tier</label>
    <p className="text-xs mb-2" style={{color:'var(--muted)'}}>
      How essential was this spend? Survival = must-have, Comfort = normal life, Aspiration = want, Investment = future return
    </p>
    <div className="grid grid-cols-2 gap-2">
      {["survival", "comfort", "aspiration", "investment"].map((t) => (
        <button
          key={t}
          onClick={() => setTier(t)}
          className={`text-xs px-3 py-2 rounded-lg border transition-all capitalize ${
            tier === t
              ? tierColor[t] + " border-transparent"
              : "border-zinc-700 text-zinc-400"
          }`}
        >
          {t}
        </button>
      ))}
    </div>
  </div>
)}

      {/* Bucket (expense only) */}
      {type === "expense" && buckets.length > 0 && (
        <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800">
          <label className="text-xs text-zinc-500 block mb-2">Bucket</label>
          <div className="flex flex-wrap gap-2">
            {buckets.map((b) => (
              <button
                key={b.id}
                onClick={() => setBucketId(b.id)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                  bucketId === b.id
                    ? "bg-blue-500/20 border-blue-500/50 text-blue-300"
                    : "border-zinc-700 text-zinc-400"
                }`}
              >
                {b.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Planned toggle */}
      {type === "expense" && (
  <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800 flex items-center justify-between">
    <div>
      <p className="text-sm" style={{color:'var(--text)'}}>Planned expense</p>
      <p className="text-xs" style={{color:'var(--muted)'}}>Was this already in your budget, or did you decide on the spot?</p>
    </div>
    <button
      onClick={() => setPlanned(!planned)}
      className={`w-12 h-6 rounded-full transition-all ${planned ? "bg-blue-500" : "bg-zinc-700"}`}
    >
      <div className={`w-5 h-5 bg-white rounded-full mx-auto transition-all ${planned ? "translate-x-3" : "-translate-x-3"}`} />
    </button>
  </div>
)}

      {/* Description */}
      <div className="bg-zinc-900 rounded-xl p-3 border border-zinc-800">
        <label className="text-xs text-zinc-500 block mb-1">Note (optional)</label>
        <input
          type="text"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What was this for?"
          className="w-full bg-transparent text-sm text-white outline-none placeholder-zinc-700"
        />
      </div>

      {/* Submit */}
      {msg && <p className={`text-sm text-center ${msg.startsWith("✓") ? "text-green-400" : "text-red-400"}`}>{msg}</p>}
      <button
        onClick={handleSubmit}
        disabled={loading}
        className="w-full py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-800 text-white rounded-xl font-medium transition-all"
      >
        {loading ? "Logging..." : "Log Transaction"}
      </button>
    </div>
  );
}

// ============================================================
// TRANSACTIONS SCREEN — full ledger with edit and delete
// ============================================================
function Transactions() {
  const [txs, setTxs] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "income" | "expense">("all");
  const [search, setSearch] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editAmount, setEditAmount] = useState("");
  const [editCategory, setEditCategory] = useState("");
  const [editTier, setEditTier] = useState("");
  const [editPlanned, setEditPlanned] = useState(true);
  const [editDescription, setEditDescription] = useState("");
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);
  const [editDate, setEditDate] = useState("");

  const loadTxs = async () => {
    try {
      const data = await invoke<Transaction[]>("get_transactions", { limit: 200 });
      setTxs(data);
    } catch {}
    finally { setLoading(false); }
  };

  useEffect(() => { loadTxs(); }, []);

  const filtered = txs.filter((tx) => {
    if (filter !== "all" && tx.type !== filter) return false;
    if (search) {
      const s = search.toLowerCase();
      return (
        tx.category.toLowerCase().includes(s) ||
        (tx.description ?? "").toLowerCase().includes(s) ||
        (tx.bucket_name ?? "").toLowerCase().includes(s) ||
        (tx.source_name ?? "").toLowerCase().includes(s)
      );
    }
    return true;
  });

  const totalIncome = filtered.filter((t) => t.type === "income").reduce((a, t) => a + t.amount, 0);
  const totalExpense = filtered.filter((t) => t.type === "expense").reduce((a, t) => a + t.amount, 0);

  const startEdit = (tx: Transaction) => {
    setEditingId(tx.id);
    setEditAmount(tx.amount.toString());
    setEditCategory(tx.category);
    setEditTier(tx.necessity_tier);
    setEditPlanned(tx.was_planned);
    setEditDescription(tx.description ?? "");
    setEditDate(tx.date);
  };

  const saveEdit = async (id: number) => {
    if (!editAmount || !editCategory) return;
    setSaving(true);
    try {
      await invoke("update_transaction", {
        id,
        amount: parseFloat(editAmount),
        date: editDate,
        category: editCategory,
        necessityTier: editTier,
        wasPlanned: editPlanned,
        description: editDescription || null,
      });
      setEditingId(null);
      await loadTxs();
    } catch (e) { alert("Error: " + e); }
    finally { setSaving(false); }
  };

  const deleteTx = async (id: number) => {
    try {
      await invoke("delete_transaction", { id });
      setConfirmDelete(null);
      await loadTxs();
    } catch (e) { alert("Error: " + e); }
  };

  const tierColor: Record<string, string> = {
    survival: "bg-red-500/20 text-red-300",
    comfort: "bg-blue-500/20 text-blue-300",
    aspiration: "bg-purple-500/20 text-purple-300",
    investment: "bg-green-500/20 text-green-300",
  };

  const tierIcon: Record<string, string> = {
    survival: "▼", comfort: "●", aspiration: "▲", investment: "◆"
  };

  if (loading) return <div className="p-4 text-sm" style={{color:'var(--muted)'}}>Loading ledger...</div>;

  return (
    <div className="flex flex-col h-full">
      {/* Search */}
      <div className="px-4 pt-3 pb-2 space-y-2">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search transactions..."
          className="w-full rounded-xl px-3 py-2 text-sm outline-none"
          style={{background:'var(--bg2)', color:'var(--text)', border:'1px solid var(--border)'}}
        />
        <div className="flex rounded-xl p-1 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
          {(["all", "income", "expense"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-all capitalize ${
                filter === f ? "bg-blue-500/20 text-blue-300" : "text-zinc-500"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-lg px-3 py-2" style={{background:'var(--bg2)', border:'1px solid var(--border)'}}>
            <p className="text-xs" style={{color:'var(--muted)'}}>In ({filtered.filter(t=>t.type==="income").length})</p>
            <p className="text-sm font-semibold text-green-400">{fmt(totalIncome)}</p>
          </div>
          <div className="rounded-lg px-3 py-2" style={{background:'var(--bg2)', border:'1px solid var(--border)'}}>
            <p className="text-xs" style={{color:'var(--muted)'}}>Out ({filtered.filter(t=>t.type==="expense").length})</p>
            <p className="text-sm font-semibold text-red-400">{fmt(totalExpense)}</p>
          </div>
        </div>
      </div>

      {/* Transaction list */}
      <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-2">
        {filtered.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-sm" style={{color:'var(--muted)'}}>No transactions found.</p>
          </div>
        ) : (
          filtered.map((tx) => (
            <div key={tx.id} className="rounded-xl border overflow-hidden"
              style={{background:'var(--bg2)', borderColor: editingId === tx.id ? '#3b82f6' : 'var(--border)'}}>

              {editingId === tx.id ? (
                /* EDIT MODE */
                <div className="p-3 space-y-3">
                  <div className="flex items-center justify-between mb-1">
                    <p className="text-xs font-medium" style={{color:'var(--text)'}}>Editing transaction</p>
                    <button onClick={() => setEditingId(null)} className="text-xs" style={{color:'var(--muted)'}}>✕ Cancel</button>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-xs block mb-1" style={{color:'var(--muted)'}}>Amount (₹)</label>
                      <input
                        type="number"
                        value={editAmount}
                        onChange={(e) => setEditAmount(e.target.value)}
                        className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                        style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}}
                      />
                    </div>
                    <div>
                      <label className="text-xs block mb-1" style={{color:'var(--muted)'}}>Category</label>
                      <input
                        type="text"
                        value={editCategory}
                        onChange={(e) => setEditCategory(e.target.value)}
                        className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                        style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}}
                      />
                    </div>
                    <div>
                      <label className="text-xs block mb-1" style={{color:'var(--muted)'}}>Date</label>
                      <input
                        type="date"
                        value={editDate}
                        onChange={(e) => setEditDate(e.target.value)}
                        className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                        style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}}
                      />
                    </div>
                  </div>

                  {tx.type === "expense" && (
                    <div>
                      <label className="text-xs block mb-1" style={{color:'var(--muted)'}}>Necessity tier</label>
                      <div className="grid grid-cols-4 gap-1">
                        {["survival","comfort","aspiration","investment"].map((t) => (
                          <button key={t} onClick={() => setEditTier(t)}
                            className={`text-xs py-1.5 rounded-lg capitalize transition-all ${
                              editTier === t ? tierColor[t] : "border"
                            }`}
                            style={editTier !== t ? {borderColor:'var(--border)', color:'var(--muted)'} : {}}
                          >{t}</button>
                        ))}
                      </div>
                    </div>
                  )}

                  <div>
                    <label className="text-xs block mb-1" style={{color:'var(--muted)'}}>Note</label>
                    <input
                      type="text"
                      value={editDescription}
                      onChange={(e) => setEditDescription(e.target.value)}
                      placeholder="What was this for?"
                      className="w-full rounded-lg px-3 py-2 text-sm outline-none"
                      style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}}
                    />
                  </div>

                  {tx.type === "expense" && (
                    <div className="flex items-center justify-between">
                      <p className="text-xs" style={{color:'var(--muted)'}}>Planned expense</p>
                      <button
                        onClick={() => setEditPlanned(!editPlanned)}
                        className={`w-10 h-5 rounded-full transition-all ${editPlanned ? "bg-blue-500" : "bg-zinc-700"}`}
                      >
                        <div className={`w-4 h-4 bg-white rounded-full mx-auto transition-all ${editPlanned ? "translate-x-2.5" : "-translate-x-2.5"}`} />
                      </button>
                    </div>
                  )}

                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmDelete(tx.id)}
                      className="px-3 py-2 rounded-lg text-xs text-red-400 border border-red-500/30 hover:bg-red-500/10 transition-all"
                    >
                      Delete
                    </button>
                    <button
                      onClick={() => saveEdit(tx.id)}
                      disabled={saving}
                      className="flex-1 py-2 rounded-lg text-sm text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 transition-all"
                    >
                      {saving ? "Saving..." : "Save changes"}
                    </button>
                  </div>
                </div>
              ) : confirmDelete === tx.id ? (
                /* DELETE CONFIRM */
                <div className="p-3">
                  <p className="text-sm font-medium mb-1" style={{color:'var(--text)'}}>Delete this transaction?</p>
                  <p className="text-xs mb-3" style={{color:'var(--muted)'}}>
                    {tx.type === "income" ? "+" : "−"}{fmt(tx.amount)} · {tx.category} · {tx.date}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmDelete(null)}
                      className="flex-1 py-2 rounded-lg text-sm"
                      style={{background:'var(--bg3)', color:'var(--muted)'}}
                    >Cancel</button>
                    <button
                      onClick={() => deleteTx(tx.id)}
                      className="flex-1 py-2 rounded-lg text-sm text-white bg-red-600 hover:bg-red-500 transition-all"
                    >Delete</button>
                  </div>
                </div>
              ) : (
                /* VIEW MODE */
                <div onClick={() => startEdit(tx)} className="cursor-pointer">
                  <div className="flex items-center gap-3 px-3 pt-3 pb-2">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-xs font-bold ${
                      tx.type === "income" ? "bg-green-500/20 text-green-400" : "bg-red-500/20 text-red-400"
                    }`}>
                      {tx.type === "income" ? "CR" : "DR"}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="text-sm font-medium" style={{color:'var(--text)'}}>{tx.category}</span>
                        {tx.subcategory && (
                          <span className="text-xs" style={{color:'var(--muted)'}}>› {tx.subcategory}</span>
                        )}
                      </div>
                      <p className="text-xs" style={{color:'var(--muted)'}}>{tx.date}</p>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className={`text-sm font-semibold ${tx.type === "income" ? "text-green-400" : "text-red-400"}`}>
                        {tx.type === "income" ? "+" : "−"}{fmt(tx.amount)}
                      </p>
                      <p className="text-xs" style={{color:'var(--muted)'}}>tap to edit</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 px-3 pb-2.5 flex-wrap">
                    {tx.type === "expense" && (
                      <span className={`text-xs px-2 py-0.5 rounded-full ${tierColor[tx.necessity_tier] ?? ""}`}>
                        {tierIcon[tx.necessity_tier]} {tx.necessity_tier}
                      </span>
                    )}
                    {tx.type === "expense" && (
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        tx.was_planned ? "bg-zinc-500/20 text-zinc-400" : "bg-yellow-500/20 text-yellow-300"
                      }`}>
                        {tx.was_planned ? "planned" : "impulse"}
                      </span>
                    )}
                    {tx.bucket_name && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-300">◫ {tx.bucket_name}</span>
                    )}
                    {tx.source_name && (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-300">↓ {tx.source_name}</span>
                    )}
                    {tx.description && (
                      <span className="text-xs" style={{color:'var(--muted)'}}>"{tx.description}"</span>
                    )}
                  </div>
                </div>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
// ============================================================
// FINANCIAL FLOOR RADAR
// ============================================================
function FloorRadar({ onSetFloor }: { onSetFloor: () => void }) {
  const [analysis, setAnalysis] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [survivalInput, setSurvivalInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  useEffect(() => {
    invoke<any>("get_floor_analysis").then(setAnalysis).finally(() => setLoading(false));
  }, []);

  const floorColors: Record<number, string> = {
    1: "text-red-400", 2: "text-yellow-400", 3: "text-blue-400", 4: "text-green-400"
  };
  const floorBg: Record<number, string> = {
    1: "border-red-500/30", 2: "border-yellow-500/30", 3: "border-blue-500/30", 4: "border-green-500/30"
  };
  const floorDesc: Record<number, string> = {
    1: "Basic needs at risk. Focus only on covering essentials.",
    2: "Stable but no buffer. Build your emergency reserve next.",
    3: "Stable with buffer. Now invest in yourself — skills, tools, growth.",
    4: "Surplus building. You're compounding financial health.",
  };

  const saveSurvivalFloor = async () => {
    if (!survivalInput) return;
    setSaving(true);
    try {
      await invoke("update_survival_floor", { amount: parseFloat(survivalInput) });
      const updated = await invoke<any>("get_floor_analysis");
      setAnalysis(updated);
      setMsg("✓ Survival floor set.");
      setSurvivalInput("");
      onSetFloor();
    } catch (e) { setMsg("Error: " + e); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="p-4 text-sm" style={{color:'var(--muted)'}}>Analysing...</div>;

  return (
    <div className="p-4 space-y-4">
      <p className="text-xs uppercase tracking-wider" style={{color:'var(--muted)'}}>Financial floor radar</p>

      {analysis && (
        <div className={`rounded-xl p-4 border ${floorBg[analysis.floor] ?? "border-zinc-700"}`}
          style={{background:'var(--bg2)'}}>
          <div className="flex justify-between items-start mb-2">
            <div>
              <p className="text-xs uppercase tracking-wider mb-1" style={{color:'var(--muted)'}}>Current floor</p>
              <p className={`text-2xl font-semibold ${floorColors[analysis.floor] ?? ""}`}>
                {analysis.floor_label}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs" style={{color:'var(--muted)'}}>MPC</p>
              <p className="text-lg font-medium" style={{color:'var(--text)'}}>
                {(analysis.mpc * 100).toFixed(0)}%
              </p>
            </div>
          </div>
          <p className="text-xs mb-4" style={{color:'var(--muted)'}}>{floorDesc[analysis.floor]}</p>

          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "Balance", val: fmt(analysis.balance) },
              { label: "Runway", val: `${analysis.runway_days.toFixed(0)} days` },
              { label: "Income", val: fmt(analysis.income) },
              { label: "Spent", val: fmt(analysis.expense) },
              { label: "Projected end-of-cycle balance", val: fmt(analysis.projected_ending_balance) },
            ].map((m) => (
              <div key={m.label} className="rounded-lg p-2" style={{background:'var(--bg3)'}}>
                <p className="text-xs" style={{color:'var(--muted)'}}>{m.label}</p>
                <p className="text-sm font-medium" style={{color:'var(--text)'}}>{m.val}</p>
              </div>
            ))}
          </div>

          {/* Floor progression */}
          <div className="mt-3 flex gap-1">
            {[1,2,3,4].map((f) => (
              <div key={f} className={`flex-1 h-1.5 rounded-full ${f <= analysis.floor ? "bg-blue-500" : "bg-zinc-700"}`} />
            ))}
          </div>
          <div className="flex justify-between mt-1">
            {["Survival","Stability","Growth","Wealth"].map((l) => (
              <span key={l} className="text-xs" style={{color:'var(--muted)'}}>{l}</span>
            ))}
          </div>
        </div>
      )}

      {/* Survival floor setter */}
      <div className="rounded-xl p-3 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
        <p className="text-xs font-medium mb-1" style={{color:'var(--text)'}}>Set survival floor</p>
        <p className="text-xs mb-3" style={{color:'var(--muted)'}}>
          Your non-negotiable monthly minimum — hostel + food + transport.
          Currently: {analysis ? fmt(analysis.survival_floor) : "₹0"}
        </p>
        <div className="flex gap-2">
          <input
            type="number"
            value={survivalInput}
            onChange={(e) => setSurvivalInput(e.target.value)}
            placeholder="e.g. 8000"
            className="flex-1 rounded-lg px-3 py-2 text-sm outline-none"
            style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}}
          />
          <button
            onClick={saveSurvivalFloor}
            disabled={saving || !survivalInput}
            className="px-4 py-2 rounded-lg text-sm text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 transition-all"
          >
            {saving ? "Saving..." : "Set"}
          </button>
        </div>
        {msg && <p className={`text-xs mt-2 ${msg.startsWith("✓") ? "text-green-400" : "text-red-400"}`}>{msg}</p>}
      </div>
    </div>
  );
}

// ============================================================
// NUDGE STRIP — loss-framed alerts
// ============================================================
function NudgeStrip() {
  const [nudges, setNudges] = useState<any[]>([]);
  const [dismissed, setDismissed] = useState<number[]>([]);

  useEffect(() => {
    invoke<any[]>("get_nudges").then(setNudges).catch(() => {});
  }, []);

  const severityStyle: Record<string, string> = {
    critical: "border-red-500/50 bg-red-500/10",
    high: "border-yellow-500/50 bg-yellow-500/10",
    medium: "border-blue-500/50 bg-blue-500/10",
  };
  const severityText: Record<string, string> = {
    critical: "text-red-300", high: "text-yellow-300", medium: "text-blue-300"
  };

  const visible = nudges.filter((_, i) => !dismissed.includes(i));
  if (visible.length === 0) return null;

  return (
    <div className="px-4 pt-3 space-y-2">
      {visible.map((n, i) => (
        <div key={i} className={`rounded-xl p-3 border flex gap-3 items-start ${severityStyle[n.severity] ?? ""}`}>
          <div className="flex-1">
            <p className={`text-xs font-medium ${severityText[n.severity] ?? ""}`}>{n.title}</p>
            <p className="text-xs mt-0.5" style={{color:'var(--muted)'}}>{n.body}</p>
          </div>
          <button
            onClick={() => setDismissed([...dismissed, nudges.indexOf(n)])}
            className="text-xs" style={{color:'var(--muted)'}}
          >✕</button>
        </div>
      ))}
    </div>
  );
}

// ============================================================
// THEME TOGGLE
// ============================================================
function ThemeToggle({ theme, setTheme }: { theme: string; setTheme: (t: any) => void }) {
  const themes: { id: "dark"|"light"|"oled"; label: string; icon: string }[] = [
    { id: "dark", label: "Dark", icon: "◑" },
    { id: "light", label: "Light", icon: "○" },
    { id: "oled", label: "OLED", icon: "●" },
  ];
  return (
    <div className="flex rounded-xl p-1 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
      {themes.map((t) => (
        <button
          key={t.id}
          onClick={() => setTheme(t.id)}
          className={`flex-1 py-2 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 ${
            theme === t.id
              ? "bg-blue-500/20 text-blue-300"
              : "text-zinc-500 hover:text-zinc-300"
          }`}
        >
          <span>{t.icon}</span>{t.label}
        </button>
      ))}
    </div>
  );
}
// ============================================================
// BUCKET MANAGER — create and edit buckets
// ============================================================
function BucketManager({ onSuccess }: {
  onSuccess: () => void;
}) {
  const [buckets, setBuckets] = useState<BucketHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"list" | "create" | "edit">("list");
  const [editingBucket, setEditingBucket] = useState<BucketHealth | null>(null);
  const [name, setName] = useState("");
  const [tier, setTier] = useState("comfort");
  const [liquidity, setLiquidity] = useState("flexible");
  const [allocValue, setAllocValue] = useState("");
  const [color, setColor] = useState("#4A90D9");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const colors = ["#4A90D9","#1D9E75","#E85D24","#9B59B6","#F39C12","#E74C3C","#1ABC9C","#3498DB"];

  useEffect(() => { loadBuckets(); }, []);

  const loadBuckets = async () => {
    try {
      const b = await invoke<BucketHealth[]>("get_bucket_health");
      setBuckets(b);
    } catch {}
    finally { setLoading(false); }
  };

  const resetForm = () => {
    setName(""); setTier("comfort"); setLiquidity("flexible");
    setAllocValue(""); setColor("#4A90D9"); setMsg("");
  };

  const startEdit = (b: BucketHealth) => {
    setEditingBucket(b);
    setName(b.name);
    setTier(b.necessity_tier);
    setLiquidity(b.liquidity);
    setAllocValue(b.allocated.toString());
    setMode("edit");
  };

  const handleCreate = async () => {
    if (!name || !allocValue) { setMsg("Name and allocation required."); return; }
    setSaving(true);
    try {
      await invoke("add_bucket", {
        bucket: {
          id: null, name, description: null, liquidity,
          alloc_type: "amount", alloc_value: parseFloat(allocValue),
          current_balance: parseFloat(allocValue),
          necessity_tier: tier, display_order: 0, color, icon: "wallet", is_active: true,
        },
      });
      setMsg("✓ Bucket created!");
      resetForm();
      await loadBuckets();
      onSuccess();
      setTimeout(() => { setMsg(""); setMode("list"); }, 800);
    } catch (e) { setMsg("Error: " + e); }
    finally { setSaving(false); }
  };

  const handleEdit = async () => {
    if (!editingBucket || !name || !allocValue) return;
    setSaving(true);
    try {
      await invoke("update_bucket", {
        id: editingBucket.id,
        name,
        allocValue: parseFloat(allocValue),
        necessityTier: tier,
        liquidity,
      });
      setMsg("✓ Updated!");
      await loadBuckets();
      onSuccess();
      setTimeout(() => { setMsg(""); setMode("list"); setEditingBucket(null); resetForm(); }, 800);
    } catch (e) { setMsg("Error: " + e); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: number) => {
  setSaving(true);
  try {
    await invoke("delete_bucket", { id });
    setConfirmDelete(null);
    await loadBuckets();
    onSuccess();
  } catch (e) { setMsg("Error: " + e); }
  finally { setSaving(false); }
};

  const form = (
    <div className="space-y-4">
      <div className="rounded-xl p-3 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
        <label className="text-xs block mb-1" style={{color:'var(--muted)'}}>Bucket name</label>
        <input type="text" value={name} onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Hostel life, Food, Books"
          className="w-full bg-transparent text-sm outline-none" style={{color:'var(--text)'}} />
      </div>

      <div className="rounded-xl p-3 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
        <label className="text-xs block mb-1" style={{color:'var(--muted)'}}>Monthly allocation (₹)</label>
        <input type="number" value={allocValue} onChange={(e) => setAllocValue(e.target.value)}
          placeholder="0"
          className="w-full bg-transparent text-2xl font-semibold outline-none" style={{color:'var(--text)'}} />
      </div>

      <div className="rounded-xl p-3 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
        <label className="text-xs block mb-2" style={{color:'var(--muted)'}}>Necessity tier</label>
        <div className="grid grid-cols-2 gap-2">
          {["survival","comfort","aspiration","investment"].map((t) => (
            <button key={t} onClick={() => setTier(t)}
              className={`text-xs px-3 py-2 rounded-lg border transition-all capitalize ${
                tier === t ? tierColor[t] + " border-transparent" : "border-zinc-700 text-zinc-400"
              }`}>{t}</button>
          ))}
        </div>
      </div>

      <div className="rounded-xl p-3 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
        <label className="text-xs block mb-2" style={{color:'var(--muted)'}}>Liquidity rule</label>
        <div className="space-y-2">
          {[
            { id: "flexible", label: "Flexible", desc: "Spend freely" },
            { id: "locked", label: "Locked", desc: "Requires confirmation" },
            { id: "overflow", label: "Overflow", desc: "Surplus spills here" },
          ].map((l) => (
            <button key={l.id} onClick={() => setLiquidity(l.id)}
              className={`w-full text-left px-3 py-2 rounded-lg border transition-all ${
                liquidity === l.id ? "bg-blue-500/20 border-blue-500/50" : "border-zinc-700"
              }`}>
              <p className={`text-xs font-medium ${liquidity === l.id ? "text-blue-300" : "text-zinc-300"}`}>{l.label}</p>
              <p className="text-xs text-zinc-500">{l.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {mode === "create" && (
        <div className="rounded-xl p-3 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
          <label className="text-xs block mb-2" style={{color:'var(--muted)'}}>Color</label>
          <div className="flex gap-2 flex-wrap">
            {colors.map((c) => (
              <button key={c} onClick={() => setColor(c)}
                className={`w-8 h-8 rounded-full border-2 transition-all ${color === c ? "border-white scale-110" : "border-transparent"}`}
                style={{background:c}} />
            ))}
          </div>
        </div>
      )}

      {msg && <p className={`text-sm text-center ${msg.startsWith("✓") ? "text-green-400" : "text-red-400"}`}>{msg}</p>}

      <div className="flex gap-2">
        <button onClick={() => { setMode("list"); resetForm(); setEditingBucket(null); }}
          className="flex-1 py-2.5 rounded-xl text-sm"
          style={{background:'var(--bg2)', color:'var(--muted)'}}>
          Cancel
        </button>
        <button
          onClick={mode === "create" ? handleCreate : handleEdit}
          disabled={saving}
          className="flex-1 py-2.5 rounded-xl text-sm text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 transition-all">
          {saving ? "Saving..." : mode === "create" ? "Create bucket" : "Save changes"}
        </button>
      </div>
    </div>
  );

  if (loading) return <div className="p-4 text-sm" style={{color:'var(--muted)'}}>Loading...</div>;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wider" style={{color:'var(--muted)'}}>
            {mode === "list" ? "Bucket management" : mode === "create" ? "Create bucket" : "Edit bucket"}
          </p>
        </div>
        {mode === "list" && (
          <button onClick={() => { resetForm(); setMode("create"); }}
            className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-all">
            + New bucket
          </button>
        )}
      </div>

      {mode !== "list" ? form : (
        <>
          {buckets.length === 0 ? (
            <div className="rounded-xl p-6 border text-center"
              style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
              <p className="text-sm" style={{color:'var(--muted)'}}>No buckets yet.</p>
              <button onClick={() => setMode("create")}
                className="mt-2 text-xs text-blue-400">+ Create your first bucket</button>
            </div>
          ) : (
            <div className="space-y-2">
              {buckets.map((b) => (
                <div key={b.id} className="rounded-xl p-3 border"
                  style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
                  <div className="flex items-center justify-between mb-2">
  <div>
    <p className="text-sm font-medium" style={{color:'var(--text)'}}>{b.name}</p>
    <p className="text-xs capitalize" style={{color:'var(--muted)'}}>
      {b.necessity_tier} · {b.liquidity} · {fmt(b.allocated)}/cycle
    </p>
  </div>
  <div className="flex items-center gap-2">
    <button onClick={() => startEdit(b)}
      className="text-xs px-3 py-1.5 rounded-lg border transition-all hover:border-blue-500/50 hover:text-blue-400"
      style={{borderColor:'var(--border)', color:'var(--muted)'}}>
      Edit
    </button>
    {confirmDelete === b.id ? (
      <div className="flex items-center gap-1 text-xs">
        <span style={{color:'var(--muted)'}}>Sure?</span>
        <button onClick={() => handleDelete(b.id!)} className="text-red-400 hover:text-red-300 px-1">Yes</button>
        <button onClick={() => setConfirmDelete(null)} style={{color:'var(--muted)'}} className="px-1">No</button>
      </div>
    ) : (
      <button onClick={() => setConfirmDelete(b.id!)}
        className="text-xs px-2 py-1.5 rounded-lg border transition-all hover:border-red-500/50 hover:text-red-400"
        style={{borderColor:'var(--border)', color:'var(--muted)'}}>
        🗑
      </button>
    )}
  </div>
</div>
                  <div className="w-full rounded-full h-1.5" style={{background:'var(--bg3)'}}>
                    <div className={`h-1.5 rounded-full transition-all ${
                      b.pct_used > 90 ? "bg-red-500" : b.pct_used > 70 ? "bg-yellow-500" : "bg-blue-500"
                    }`} style={{width:`${Math.min(b.pct_used,100)}%`}} />
                  </div>
                  <div className="flex justify-between mt-1">
                    <span className="text-xs" style={{color:'var(--muted)'}}>{fmt(b.spent_this_cycle)} spent</span>
                    <span className="text-xs" style={{color:'var(--muted)'}}>{fmt(b.remaining)} left</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
// ============================================================
// NET WORTH CURVE — Modigliani's hump, made personal
// ============================================================
function NetWorthCurve() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [settingBaseline, setSettingBaseline] = useState(false);
  const [cycleTrend, setCycleTrend] = useState<any>(null);

  useEffect(() => {
    invoke<any[]>("get_net_worth_curve")
      .then((raw) => {
        const formatted = raw.map((d) => ({
          date: d.date.slice(5),
          value: Math.round(d.net_worth),
          full_date: d.date,
        }));
        setData(formatted);
      })
      .finally(() => setLoading(false));
    invoke<any>("get_multi_cycle_trend").then(setCycleTrend);
  }, []);

  const max = data.length ? Math.max(...data.map((d) => d.value)) : 0;
  const min = data.length ? Math.min(...data.map((d) => d.value)) : 0;
  const latest = data[data.length - 1]?.value ?? 0;
  const earliest = data[0]?.value ?? 0;
  const trend = latest - earliest;

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const val = payload[0].value;
      return (
        <div className="rounded-xl px-3 py-2 border text-xs"
          style={{background:'var(--bg2)', borderColor:'var(--border)', color:'var(--text)'}}>
          <p style={{color:'var(--muted)'}}>{payload[0].payload.full_date}</p>
          <p className={`font-semibold mt-0.5 ${val >= 0 ? "text-green-400" : "text-red-400"}`}>
            {fmt(val)}
          </p>
        </div>
      );
    }
    return null;
  };

  if (loading) return (
    <div className="p-4 text-sm" style={{color:'var(--muted)'}}>Loading curve...</div>
  );

  const startFresh = async () => {
    if (!confirm("This locks in today's balance as your curve's starting point. Everything before today collapses into one point; everything after is tracked fresh with real dates. This can't be undone. Continue?")) return;
    setSettingBaseline(true);
    try {
      await invoke("set_curve_baseline");
      const raw = await invoke<any[]>("get_net_worth_curve");
      setData(raw.map((d) => ({ date: d.date.slice(5), value: Math.round(d.net_worth), full_date: d.date })));
    } catch (e) {
      alert("Error: " + e);
    } finally {
      setSettingBaseline(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-start justify-between">
      <button
        onClick={startFresh}
        disabled={settingBaseline}
        className="w-full py-2 rounded-lg text-xs border transition-all"
        style={{borderColor:'var(--border)', color:'var(--muted)'}}
      >
        {settingBaseline ? "Setting..." : "Start fresh from today"}
      </button>
        <div>
          <p className="text-xs uppercase tracking-wider" style={{color:'var(--muted)'}}>Net worth curve</p>
          <p className="text-xs mt-0.5" style={{color:'var(--muted)'}}>Your full financial trajectory since day one</p>
        </div>
        <div className="text-right">
          <p className={`text-lg font-semibold ${latest >= 0 ? "text-green-400" : "text-red-400"}`}>
            {fmt(latest)}
          </p>
          <p className={`text-xs ${trend >= 0 ? "text-green-400" : "text-red-400"}`}>
            {trend >= 0 ? "↑" : "↓"} {fmt(Math.abs(trend))} overall
          </p>
        </div>
      </div>

      {data.length < 2 ? (
        <div className="rounded-xl p-8 border text-center"
          style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
          <p className="text-sm" style={{color:'var(--muted)'}}>Log at least 2 transactions to see your curve.</p>
        </div>
      ) : (
        <div className="rounded-xl p-4 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart data={data} margin={{top:8, right:8, bottom:8, left:8}}>
              <XAxis
                dataKey="date"
                tick={{fontSize:10, fill:'var(--muted)'}}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{fontSize:10, fill:'var(--muted)'}}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `₹${(v/1000).toFixed(0)}k`}
                width={40}
              />
              <Tooltip content={<CustomTooltip />} />
              <ReferenceLine y={0} stroke="var(--border)" strokeDasharray="4 4" />
              <Line
                type="monotone"
                dataKey="value"
                stroke={latest >= 0 ? "#22c55e" : "#ef4444"}
                strokeWidth={2}
                dot={false}
                activeDot={{r:4, fill: latest >= 0 ? "#22c55e" : "#ef4444"}}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-3 gap-3">
        <div className="rounded-xl p-3 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
          <p className="text-xs" style={{color:'var(--muted)'}}>Peak</p>
          <p className="text-sm font-medium text-green-400">{fmt(max)}</p>
        </div>
        <div className="rounded-xl p-3 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
          <p className="text-xs" style={{color:'var(--muted)'}}>Low</p>
          <p className="text-sm font-medium text-red-400">{fmt(min)}</p>
        </div>
        <div className="rounded-xl p-3 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
          <p className="text-xs" style={{color:'var(--muted)'}}>Data points</p>
          <p className="text-sm font-medium" style={{color:'var(--text)'}}>{data.length}</p>
        </div>
      </div>
      {cycleTrend && !cycleTrend.insufficient_data && (
        <div className="rounded-xl p-3 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
          <p className="text-xs" style={{color:'var(--muted)'}}>Trend — based on your last 3 cycles</p>
          <p className={`text-sm ${cycleTrend.trend_direction === "up" ? "text-green-400" : cycleTrend.trend_direction === "down" ? "text-red-400" : "text-zinc-400"}`}>
            Averaging {fmt(cycleTrend.avg_net_per_cycle)}/cycle · projected {fmt(cycleTrend.projections[2].projected_net_worth)} in 3 cycles
          </p>
        </div>
      )}
      {cycleTrend && cycleTrend.insufficient_data && (
        <p className="text-xs px-1" style={{color:'var(--muted)'}}>
          Trend projection needs at least 3 closed cycles ({cycleTrend.closed_cycles}/3 so far).
        </p>
      )}
      <p className="text-xs px-1" style={{color:'var(--muted)'}}>
        Grounded in Modigliani's life cycle hypothesis — the shape of this curve tells you more than any monthly snapshot.
      </p>
    </div>
  );
}
// ============================================================
// FINANCIAL IDENTITY CARD
// ============================================================
function FinancialIdentityCard() {
  const [identity, setIdentity] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
  invoke<any>("get_financial_identity")
    .then((data) => {
      console.log("Identity data:", data);
      setIdentity(data);
    })
    .catch((err) => {
      console.error("Identity error:", err);
    })
    .finally(() => setLoading(false));
}, []);

  if (loading) return (
    <div className="p-4 text-sm" style={{color:'var(--muted)'}}>Building your identity...</div>
  );

  if (!identity) return (
    <div className="p-4 text-sm" style={{color:'var(--muted)'}}>No data yet. Log some transactions first.</div>
  );

  const floorColor: Record<number, string> = {
    1: "text-red-400", 2: "text-yellow-400", 3: "text-blue-400", 4: "text-green-400"
  };
  const floorBg: Record<number, string> = {
    1: "rgba(239,68,68,0.1)", 2: "rgba(234,179,8,0.1)", 3: "rgba(59,130,246,0.1)", 4: "rgba(34,197,94,0.1)"
  };
  const floorBorder: Record<number, string> = {
    1: "rgba(239,68,68,0.3)", 2: "rgba(234,179,8,0.3)", 3: "rgba(59,130,246,0.3)", 4: "rgba(34,197,94,0.3)"
  };

  const mpcRating = identity.mpc < 0.5 ? "Excellent" : identity.mpc < 0.7 ? "Good" : identity.mpc < 0.9 ? "Caution" : "Critical";
  const mpcColor = identity.mpc < 0.5 ? "text-green-400" : identity.mpc < 0.7 ? "text-blue-400" : identity.mpc < 0.9 ? "text-yellow-400" : "text-red-400";
  const impulseRating = identity.impulse_ratio < 0.1 ? "Disciplined" : identity.impulse_ratio < 0.25 ? "Moderate" : identity.impulse_ratio < 0.4 ? "Watch out" : "High risk";
  const impulseColor = identity.impulse_ratio < 0.1 ? "text-green-400" : identity.impulse_ratio < 0.25 ? "text-blue-400" : identity.impulse_ratio < 0.4 ? "text-yellow-400" : "text-red-400";

  return (
    <div className="p-4 space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wider" style={{color:'var(--muted)'}}>Financial identity</p>
        <p className="text-xs mt-0.5" style={{color:'var(--muted)'}}>Derived from your real data — not self-reported</p>
      </div>

      {/* Hero card */}
      <div className="rounded-2xl p-4 border"
        style={{background: floorBg[identity.current_floor], borderColor: floorBorder[identity.current_floor]}}>
        <div className="flex items-start justify-between mb-3">
          <div>
            <p className="text-xs uppercase tracking-wider mb-1" style={{color:'var(--muted)'}}>
              {identity.life_stage.replace("_", " ")}
            </p>
            <p className="text-2xl font-semibold" style={{color:'var(--text)'}}>{identity.name}</p>
          </div>
          <div className="text-right">
            <p className={`text-lg font-bold ${floorColor[identity.current_floor]}`}>
              {identity.floor_label}
            </p>
            <p className="text-xs" style={{color:'var(--muted)'}}>financial floor</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <div className="rounded-xl p-3" style={{background:'rgba(0,0,0,0.2)'}}>
            <p className="text-xs" style={{color:'var(--muted)'}}>Net balance</p>
            <p className={`text-lg font-semibold ${identity.balance >= 0 ? "text-green-400" : "text-red-400"}`}>
              {fmt(identity.balance)}
            </p>
          </div>
          <div className="rounded-xl p-3" style={{background:'rgba(0,0,0,0.2)'}}>
            <p className="text-xs" style={{color:'var(--muted)'}}>Runway</p>
            <p className="text-lg font-semibold" style={{color:'var(--text)'}}>
              {identity.runway_days.toFixed(0)} days
            </p>
          </div>
        </div>
      </div>

      {/* Behavioral metrics */}
      <div>
        <p className="text-xs uppercase tracking-wider mb-2" style={{color:'var(--muted)'}}>Behavioral fingerprint</p>
        <div className="space-y-2">

          {/* MPC */}
          <div className="rounded-xl p-3 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
            <div className="flex justify-between items-center mb-1.5">
              <div>
                <p className="text-xs font-medium" style={{color:'var(--text)'}}>Marginal propensity to consume</p>
                <p className="text-xs" style={{color:'var(--muted)'}}>Fraction of income you spend (Keynes)</p>
              </div>
              <div className="text-right">
                <p className={`text-sm font-bold ${mpcColor}`}>{(identity.mpc * 100).toFixed(0)}%</p>
                <p className={`text-xs ${mpcColor}`}>{mpcRating}</p>
              </div>
            </div>
            <div className="w-full rounded-full h-1.5" style={{background:'var(--bg3)'}}>
              <div className="h-1.5 rounded-full transition-all"
                style={{width:`${Math.min(identity.mpc * 100, 100)}%`,
                  background: identity.mpc < 0.5 ? '#22c55e' : identity.mpc < 0.7 ? '#3b82f6' : identity.mpc < 0.9 ? '#eab308' : '#ef4444'}} />
            </div>
          </div>

          {/* Impulse ratio */}
          <div className="rounded-xl p-3 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
            <div className="flex justify-between items-center mb-1.5">
              <div>
                <p className="text-xs font-medium" style={{color:'var(--text)'}}>Impulse spending ratio</p>
                <p className="text-xs" style={{color:'var(--muted)'}}>Unplanned spend as % of total (Kahneman)</p>
              </div>
              <div className="text-right">
                <p className={`text-sm font-bold ${impulseColor}`}>{(identity.impulse_ratio * 100).toFixed(0)}%</p>
                <p className={`text-xs ${impulseColor}`}>{impulseRating}</p>
              </div>
            </div>
            <div className="w-full rounded-full h-1.5" style={{background:'var(--bg3)'}}>
              <div className="h-1.5 rounded-full transition-all"
                style={{width:`${Math.min(identity.impulse_ratio * 100, 100)}%`,
                  background: identity.impulse_ratio < 0.1 ? '#22c55e' : identity.impulse_ratio < 0.25 ? '#3b82f6' : identity.impulse_ratio < 0.4 ? '#eab308' : '#ef4444'}} />
            </div>
          </div>

          {/* Self investment */}
          <div className="rounded-xl p-3 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
            <div className="flex justify-between items-center mb-1.5">
              <div>
                <p className="text-xs font-medium" style={{color:'var(--text)'}}>Self-investment ratio</p>
                <p className="text-xs" style={{color:'var(--muted)'}}>Spend on growth vs total (Modigliani)</p>
              </div>
              <div className="text-right">
                <p className="text-sm font-bold text-purple-400">{(identity.self_investment_ratio * 100).toFixed(0)}%</p>
                <p className="text-xs text-purple-400">
                  {identity.self_investment_ratio > 0.15 ? "Investing well" : identity.self_investment_ratio > 0.05 ? "Moderate" : "Low"}
                </p>
              </div>
            </div>
            <div className="w-full rounded-full h-1.5" style={{background:'var(--bg3)'}}>
              <div className="h-1.5 rounded-full bg-purple-500 transition-all"
                style={{width:`${Math.min(identity.self_investment_ratio * 100 * 4, 100)}%`}} />
            </div>
          </div>
        </div>
      </div>

      {/* Quick stats */}
      <div>
        <p className="text-xs uppercase tracking-wider mb-2" style={{color:'var(--muted)'}}>Ledger stats</p>
        <div className="grid grid-cols-2 gap-2">
          {[
            { label: "Top category", value: identity.top_category },
            { label: "Dominant tier", value: identity.dominant_tier },
            { label: "Cycles completed", value: identity.cycles_completed.toString() },
            { label: "Total transactions", value: identity.total_transactions.toString() },
            { label: "Income sources", value: identity.source_count.toString() },
            { label: "Survival floor", value: fmt(identity.survival_floor) + "/mo" },
          ].map((s) => (
            <div key={s.label} className="rounded-xl p-3 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
              <p className="text-xs" style={{color:'var(--muted)'}}>{s.label}</p>
              <p className="text-sm font-medium mt-0.5 capitalize" style={{color:'var(--text)'}}>{s.value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* This cycle */}
      <div className="rounded-xl p-3 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
        <p className="text-xs uppercase tracking-wider mb-2" style={{color:'var(--muted)'}}>This cycle</p>
        <div className="grid grid-cols-3 gap-2">
          <div>
            <p className="text-xs" style={{color:'var(--muted)'}}>Income</p>
            <p className="text-sm font-medium text-green-400">{fmt(identity.income)}</p>
          </div>
          <div>
            <p className="text-xs" style={{color:'var(--muted)'}}>Spent</p>
            <p className="text-sm font-medium text-red-400">{fmt(identity.expense)}</p>
          </div>
          <div>
            <p className="text-xs" style={{color:'var(--muted)'}}>Saved</p>
            <p className={`text-sm font-medium ${identity.income - identity.expense >= 0 ? "text-blue-400" : "text-red-400"}`}>
              {fmt(identity.income - identity.expense)}
            </p>
          </div>
        </div>
      </div>

      <p className="text-xs px-1" style={{color:'var(--muted)'}}>
        Updated in real-time from your transaction history. Every number here is earned, not estimated.
      </p>
    </div>
  );
}
// ============================================================
// PERIOD COMPARISON
// ============================================================
function PeriodComparison() {
  const [cycles, setCycles] = useState<any[]>([]);
  const [cycleA, setCycleA] = useState<number | null>(null);
  const [cycleB, setCycleB] = useState<number | null>(null);
  const [comparison, setComparison] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [loadingCycles, setLoadingCycles] = useState(true);

  useEffect(() => {
  invoke<any[]>("get_cycle_history")
    .then((data) => {
      console.log("Cycles loaded:", data);
      setCycles(data);
    })
    .catch((err) => {
      console.error("Cycles error:", err);
    })
    .finally(() => setLoadingCycles(false));
}, []);

  const compare = async () => {
    if (!cycleA || !cycleB) return;
    setLoading(true);
    try {
      const result = await invoke<any>("compare_cycles", { cycleA, cycleB });
      setComparison(result);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const Delta = ({ a, b, prefix = "₹", higherIsBetter = true }: {
    a: number; b: number; prefix?: string; higherIsBetter?: boolean
  }) => {
    const diff = b - a;
    const improved = higherIsBetter ? diff > 0 : diff < 0;
    if (diff === 0) return <span className="text-xs" style={{color:'var(--muted)'}}>No change</span>;
    return (
      <span className={`text-xs font-medium ${improved ? "text-green-400" : "text-red-400"}`}>
        {diff > 0 ? "↑" : "↓"} {prefix}{Math.abs(diff).toLocaleString("en-IN", {maximumFractionDigits: 2})}
      </span>
    );
  };

  if (loadingCycles) return <div className="p-4 text-sm" style={{color:'var(--muted)'}}>Loading cycles...</div>;

  return (
    <div className="p-4 space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wider" style={{color:'var(--muted)'}}>Period comparison</p>
        <p className="text-xs mt-0.5" style={{color:'var(--muted)'}}>Compare any two cycles side by side</p>
      </div>

      {cycles.length < 2 ? (
        <div className="rounded-xl p-6 border text-center" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
          <p className="text-sm" style={{color:'var(--muted)'}}>You need at least 2 cycles to compare.</p>
          <p className="text-xs mt-1" style={{color:'var(--muted)'}}>Complete your current cycle and start a new one.</p>
        </div>
      ) : (
        <>
          {/* Cycle selectors */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs mb-1" style={{color:'var(--muted)'}}>Cycle A</p>
              <select
                value={cycleA ?? ""}
                onChange={(e) => setCycleA(Number(e.target.value))}
                className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                style={{background:'var(--bg2)', color:'var(--text)', border:'1px solid var(--border)'}}
              >
                <option value="">Select...</option>
                {cycles.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <p className="text-xs mb-1" style={{color:'var(--muted)'}}>Cycle B</p>
              <select
                value={cycleB ?? ""}
                onChange={(e) => setCycleB(Number(e.target.value))}
                className="w-full rounded-xl px-3 py-2 text-sm outline-none"
                style={{background:'var(--bg2)', color:'var(--text)', border:'1px solid var(--border)'}}
              >
                <option value="">Select...</option>
                {cycles.map((c) => (
                  <option key={c.id} value={c.id}>{c.label}</option>
                ))}
              </select>
            </div>
          </div>

          <button
            onClick={compare}
            disabled={!cycleA || !cycleB || cycleA === cycleB || loading}
            className="w-full py-2.5 rounded-xl text-sm text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-40 transition-all"
          >
            {loading ? "Comparing..." : "Compare cycles"}
          </button>

          {/* Comparison results */}
          {comparison && (
            <div className="space-y-3">
              {/* Header */}
              <div className="grid grid-cols-3 gap-2 text-xs font-medium">
                <div style={{color:'var(--muted)'}}>Metric</div>
                <div className="text-center text-blue-400">{comparison.a.label}</div>
                <div className="text-center text-purple-400">{comparison.b.label}</div>
              </div>

              {/* Rows */}
              {[
                { label: "Income", keyName: "income", higherIsBetter: true },
                { label: "Expenses", keyName: "expense", higherIsBetter: false },
                { label: "Net saved", keyName: "net", higherIsBetter: true },
                { label: "Impulse spend", keyName: "impulse", higherIsBetter: false },
                { label: "Transactions", keyName: "tx_count", higherIsBetter: true },
              ].map((row) => (
                <div key={row.keyName} className="rounded-xl p-3 border"
                  style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
                  <div className="grid grid-cols-3 gap-2 items-center">
                    <div>
                      <p className="text-xs font-medium" style={{color:'var(--text)'}}>{row.label}</p>
                      <Delta
                        a={comparison.a[row.keyName]}
                        b={comparison.b[row.keyName]}
                        prefix={row.keyName === "tx_count" ? "" : "₹"}
                        higherIsBetter={row.higherIsBetter}
                      />
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium text-blue-400">
                        {row.keyName === "tx_count"
                          ? comparison.a[row.keyName]
                          : fmt(comparison.a[row.keyName])}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-sm font-medium text-purple-400">
                        {row.keyName === "tx_count"
                          ? comparison.b[row.keyName]
                          : fmt(comparison.b[row.keyName])}
                      </p>
                    </div>
                  </div>
                </div>
              ))}

              {/* MPC comparison */}
              <div className="rounded-xl p-3 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
                <div className="grid grid-cols-3 gap-2 items-center">
                  <div>
                    <p className="text-xs font-medium" style={{color:'var(--text)'}}>MPC</p>
                    <Delta
                      a={comparison.a.mpc}
                      b={comparison.b.mpc}
                      prefix=""
                      higherIsBetter={false}
                    />
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-blue-400">
                      {(comparison.a.mpc * 100).toFixed(0)}%
                    </p>
                  </div>
                  <div className="text-center">
                    <p className="text-sm font-medium text-purple-400">
                      {(comparison.b.mpc * 100).toFixed(0)}%
                    </p>
                  </div>
                </div>
              </div>

              {/* Top categories */}
              <div className="rounded-xl p-3 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
                <div className="grid grid-cols-3 gap-2 items-center">
                  <p className="text-xs font-medium" style={{color:'var(--text)'}}>Top category</p>
                  <p className="text-xs text-center text-blue-400">{comparison.a.top_category}</p>
                  <p className="text-xs text-center text-purple-400">{comparison.b.top_category}</p>
                </div>
              </div>

              {/* Verdict */}
              <div className="rounded-xl p-3 border border-blue-500/20"
                style={{background:'rgba(59,130,246,0.05)'}}>
                <p className="text-xs font-medium mb-1" style={{color:'var(--text)'}}>Verdict</p>
                <p className="text-xs" style={{color:'var(--muted)'}}>
                  {comparison.b.net > comparison.a.net
                    ? `${comparison.b.label} was stronger — you saved ${fmt(comparison.b.net - comparison.a.net)} more.`
                    : comparison.a.net > comparison.b.net
                    ? `${comparison.a.label} was stronger — you saved ${fmt(comparison.a.net - comparison.b.net)} more.`
                    : "Both cycles performed equally."}
                  {comparison.b.mpc < comparison.a.mpc
                    ? ` Spending discipline improved.`
                    : comparison.b.mpc > comparison.a.mpc
                    ? ` Spending discipline declined.`
                    : ""}
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
// ============================================================
// SOURCE RELIABILITY SCORING
// ============================================================
function SourceReliability() {
  const [sources, setSources] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    invoke<any[]>("get_source_reliability")
      .then(setSources)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-4 text-sm" style={{color:'var(--muted)'}}>Analysing sources...</div>;

  const reliabilityColor = (score: number) =>
    score > 0.8 ? "text-green-400" : score > 0.5 ? "text-yellow-400" : "text-red-400";
  const reliabilityBg = (score: number) =>
    score > 0.8 ? "bg-green-500/20" : score > 0.5 ? "bg-yellow-500/20" : "bg-red-500/20";

  return (
    <div className="p-4 space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wider" style={{color:'var(--muted)'}}>Source reliability</p>
        <p className="text-xs mt-0.5" style={{color:'var(--muted)'}}>
          How dependable is each income source — your financial fragility map
        </p>
      </div>

      {sources.length === 0 ? (
        <div className="rounded-xl p-6 border text-center"
          style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
          <p className="text-sm" style={{color:'var(--muted)'}}>No income sources tracked yet.</p>
          <p className="text-xs mt-1" style={{color:'var(--muted)'}}>
            Log income transactions with source tags to see reliability scores.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {sources.map((s) => (
            <div key={s.id} className="rounded-xl p-4 border"
              style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="text-sm font-medium" style={{color:'var(--text)'}}>{s.name}</p>
                  <p className="text-xs mt-0.5 capitalize" style={{color:'var(--muted)'}}>
                    {s.source_type.replace("_"," ")}
                  </p>
                </div>
                <div className="text-right">
                  <span className={`text-xs px-2 py-1 rounded-full font-medium ${reliabilityBg(s.reliability_score)} ${reliabilityColor(s.reliability_score)}`}>
                    {s.reliability_label} reliability
                  </span>
                  <p className={`text-lg font-bold mt-1 ${reliabilityColor(s.reliability_score)}`}>
                    {(s.reliability_score * 100).toFixed(0)}%
                  </p>
                </div>
              </div>

              {/* Reliability bar */}
              <div className="w-full rounded-full h-1.5 mb-3" style={{background:'var(--bg3)'}}>
                <div className="h-1.5 rounded-full transition-all"
                  style={{
                    width:`${s.reliability_score * 100}%`,
                    background: s.reliability_score > 0.8 ? '#22c55e' :
                      s.reliability_score > 0.5 ? '#eab308' : '#ef4444'
                  }} />
              </div>

              <div className="grid grid-cols-2 gap-2 mb-2">
                <div className="rounded-lg p-2" style={{background:'var(--bg3)'}}>
                  <p className="text-xs" style={{color:'var(--muted)'}}>Total received</p>
                  <p className="text-sm font-medium text-green-400">{fmt(s.total_received)}</p>
                </div>
                <div className="rounded-lg p-2" style={{background:'var(--bg3)'}}>
                  <p className="text-xs" style={{color:'var(--muted)'}}>Avg per transaction</p>
                  <p className="text-sm font-medium" style={{color:'var(--text)'}}>{fmt(s.avg_actual)}</p>
                </div>
                <div className="rounded-lg p-2" style={{background:'var(--bg3)'}}>
                  <p className="text-xs" style={{color:'var(--muted)'}}>Arrival rate</p>
                  <p className="text-sm font-medium" style={{color:'var(--text)'}}>
                    {s.cycles_appeared}/{s.total_cycles} cycles
                  </p>
                </div>
                <div className="rounded-lg p-2" style={{background:'var(--bg3)'}}>
                  <p className="text-xs" style={{color:'var(--muted)'}}>Amount range</p>
                  <p className="text-sm font-medium" style={{color:'var(--text)'}}>
                    {fmt(s.min_received)}–{fmt(s.max_received)}
                  </p>
                </div>
              </div>

              {s.expected_amount && (
                <p className="text-xs" style={{color:'var(--muted)'}}>
                  Expected: {fmt(s.expected_amount)} · Amount consistency: {(s.amount_consistency * 100).toFixed(0)}%
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// BEHAVIORAL PATTERN RECOGNITION
// ============================================================
function BehavioralPatterns() {
  const [patterns, setPatterns] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    invoke<any>("get_behavioral_patterns")
      .then(setPatterns)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-4 text-sm" style={{color:'var(--muted)'}}>Analysing behavior...</div>;
  if (!patterns) return <div className="p-4 text-sm" style={{color:'var(--muted)'}}>No data yet.</div>;

  const maxDow = Math.max(...patterns.day_of_week.map((d: any) => d.total_amount));

  return (
    <div className="p-4 space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wider" style={{color:'var(--muted)'}}>Behavioral patterns</p>
        <p className="text-xs mt-0.5" style={{color:'var(--muted)'}}>
          Your personal spending patterns — detected from real history
        </p>
      </div>

      {/* Peak day alert */}
      <div className="rounded-xl p-3 border border-blue-500/20"
        style={{background:'rgba(59,130,246,0.05)'}}>
        <p className="text-xs text-blue-400 uppercase tracking-wider mb-1">Peak spending day</p>
        <p className="text-lg font-semibold" style={{color:'var(--text)'}}>{patterns.peak_day}</p>
        <p className="text-xs" style={{color:'var(--muted)'}}>
          You spend most on {patterns.peak_day}s. Be more intentional on this day.
        </p>
      </div>

      {/* Day of week chart */}
      <div className="rounded-xl p-4 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
        <p className="text-xs mb-3" style={{color:'var(--muted)'}}>Spending by day of week</p>
        <div className="space-y-2">
          {patterns.day_of_week.map((d: any) => (
            <div key={d.day} className="flex items-center gap-3">
              <p className="text-xs w-20 flex-shrink-0" style={{color:'var(--muted)'}}>{d.day}</p>
              <div className="flex-1 rounded-full h-2" style={{background:'var(--bg3)'}}>
                <div
                  className="h-2 rounded-full transition-all bg-blue-500"
                  style={{width: maxDow > 0 ? `${(d.total_amount / maxDow) * 100}%` : '0%'}}
                />
              </div>
              <p className="text-xs w-16 text-right flex-shrink-0" style={{color:'var(--text)'}}>
                {d.total_amount > 0 ? fmt(d.total_amount) : "—"}
              </p>
            </div>
          ))}
        </div>
      </div>

      {/* Impulse overview */}
      <div className="rounded-xl p-3 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
        <p className="text-xs font-medium mb-2" style={{color:'var(--text)'}}>Planned vs impulse overview</p>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div className="rounded-lg p-2" style={{background:'var(--bg3)'}}>
            <p className="text-xs" style={{color:'var(--muted)'}}>Planned spend</p>
            <p className="text-sm font-medium text-green-400">{fmt(patterns.total_planned)}</p>
          </div>
          <div className="rounded-lg p-2" style={{background:'var(--bg3)'}}>
            <p className="text-xs" style={{color:'var(--muted)'}}>Impulse spend</p>
            <p className="text-sm font-medium text-yellow-400">{fmt(patterns.total_impulse)}</p>
          </div>
        </div>
        <div className="w-full rounded-full h-2" style={{background:'var(--bg3)'}}>
          <div className="h-2 rounded-full bg-yellow-400 transition-all"
            style={{width:`${patterns.impulse_ratio * 100}%`}} />
        </div>
        <p className="text-xs mt-1.5" style={{color:'var(--muted)'}}>
          {(patterns.impulse_ratio * 100).toFixed(0)}% of total spend is impulse
        </p>
      </div>

      {/* Impulse by category */}
      {patterns.impulse_by_category.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wider mb-2" style={{color:'var(--muted)'}}>
            Top impulse categories
          </p>
          <div className="space-y-2">
            {patterns.impulse_by_category.map((c: any) => (
              <div key={c.category} className="rounded-xl p-3 border"
                style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium" style={{color:'var(--text)'}}>{c.category}</p>
                  <p className="text-sm font-semibold text-yellow-400">{fmt(c.impulse_total)}</p>
                </div>
                <p className="text-xs mt-0.5" style={{color:'var(--muted)'}}>
                  {c.impulse_count} impulse · {c.planned_count} planned
                </p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
// ============================================================
// GHOST BUCKET DETECTOR
// ============================================================
function GhostBuckets({ setScreen }: { setScreen: (s: Screen) => void }) {
  const [ghosts, setGhosts] = useState<any[]>([]);
  const [buckets, setBuckets] = useState<BucketHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Record<number, number>>({});
  const [assigning, setAssigning] = useState<number | null>(null);
  const [result, setResult] = useState<Record<number, string>>({});

  const loadGhosts = async () => {
    try {
      const [g, b] = await Promise.all([
        invoke<any[]>("get_ghost_buckets"),
        invoke<BucketHealth[]>("get_bucket_health"),
      ]);
      setGhosts(g);
      setBuckets(b);
    } finally { setLoading(false); }
  };

  useEffect(() => { loadGhosts(); }, []);

  const assign = async (i: number, category: string) => {
    const bucketId = selected[i];
    if (!bucketId) return;
    setAssigning(i);
    try {
      const count = await invoke<number>("bulk_assign_category_to_bucket", { category, bucketId });
      setResult((r) => ({ ...r, [i]: `✓ ${count} transactions moved` }));
      await loadGhosts();
    } catch (e) {
      setResult((r) => ({ ...r, [i]: "Error: " + e }));
    } finally {
      setAssigning(null);
    }
  };

  if (loading) return <div className="p-4 text-sm" style={{color:'var(--muted)'}}>Scanning...</div>;

  return (
    <div className="p-4 space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wider" style={{color:'var(--muted)'}}>Ghost bucket detector</p>
        <p className="text-xs mt-0.5" style={{color:'var(--muted)'}}>
          Money leaking without a bucket — Thaler's mental accounting gap
        </p>
      </div>

      {ghosts.length === 0 ? (
        <div className="rounded-xl p-6 border text-center"
          style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
          <p className="text-sm text-green-400">No ghost spending detected.</p>
          <p className="text-xs mt-1" style={{color:'var(--muted)'}}>
            All significant spend has a bucket assigned.
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-xl p-3 border border-yellow-500/20"
            style={{background:'rgba(234,179,8,0.05)'}}>
            <p className="text-xs text-yellow-400 mb-1">
              {ghosts.length} categories spending without a bucket
            </p>
            <p className="text-xs" style={{color:'var(--muted)'}}>
              Assign each to an existing bucket, or create one first from Buckets.
            </p>
          </div>

          <div className="space-y-2">
            {ghosts.map((g, i) => (
              <div key={i} className="rounded-xl p-3 border"
                style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <p className="text-sm font-medium" style={{color:'var(--text)'}}>{g.category}</p>
                    <p className="text-xs mt-0.5" style={{color:'var(--muted)'}}>
                      {g.tx_count} transactions · avg {fmt(g.avg_amount)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-yellow-400">{fmt(g.total_spent)}</p>
                    <p className="text-xs" style={{color:'var(--muted)'}}>unbucketed</p>
                  </div>
                </div>

                {buckets.length === 0 ? (
                  <button
                    onClick={() => setScreen("buckets")}
                    className="text-xs mt-2 text-yellow-400 hover:text-yellow-300 text-left transition-all"
                  >
                    → Create a bucket first →
                  </button>
                ) : (
                  <div className="flex gap-2 mt-2">
                    <select
                      value={selected[i] || ""}
                      onChange={(e) => setSelected((s) => ({ ...s, [i]: parseInt(e.target.value) }))}
                      className="flex-1 rounded-lg px-2 py-1.5 text-xs outline-none"
                      style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}}
                    >
                      <option value="">Assign to bucket...</option>
                      {buckets.map((b) => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => assign(i, g.category)}
                      disabled={!selected[i] || assigning === i}
                      className="text-xs px-3 py-1.5 rounded-lg text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50"
                    >
                      {assigning === i ? "..." : "Assign"}
                    </button>
                  </div>
                )}
                {result[i] && <p className="text-xs mt-1" style={{color: result[i].startsWith("✓") ? "#4ade80" : "#f87171"}}>{result[i]}</p>}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ============================================================
// BUCKET ARCHAEOLOGY
// ============================================================
function BucketArchaeology() {
  const [buckets, setBuckets] = useState<any[]>([]);
  const [selected, setSelected] = useState<number | null>(null);
  const [archaeology, setArchaeology] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [loadingArch, setLoadingArch] = useState(false);

  useEffect(() => {
    invoke<any[]>("get_bucket_health")
      .then(setBuckets)
      .finally(() => setLoading(false));
  }, []);

  const openBucket = async (id: number) => {
    setSelected(id);
    setLoadingArch(true);
    try {
      const data = await invoke<any>("get_bucket_archaeology", { bucketId: id });
      setArchaeology(data);
    } catch (e) { console.error(e); }
    finally { setLoadingArch(false); }
  };

  if (loading) return <div className="p-4 text-sm" style={{color:'var(--muted)'}}>Loading...</div>;

  return (
    <div className="p-4 space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wider" style={{color:'var(--muted)'}}>Bucket archaeology</p>
        <p className="text-xs mt-0.5" style={{color:'var(--muted)'}}>
          The full biography of every bucket across every cycle
        </p>
      </div>

      {buckets.length === 0 ? (
        <div className="rounded-xl p-6 border text-center"
          style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
          <p className="text-sm" style={{color:'var(--muted)'}}>No buckets yet. Create some first.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap gap-2">
            {buckets.map((b) => (
              <button
                key={b.id}
                onClick={() => openBucket(b.id)}
                className={`text-xs px-3 py-1.5 rounded-full border transition-all ${
                  selected === b.id
                    ? "bg-blue-500/20 border-blue-500/50 text-blue-300"
                    : "border-zinc-700 text-zinc-400 hover:border-zinc-500"
                }`}
              >
                {b.name}
              </button>
            ))}
          </div>

          {loadingArch && (
            <div className="text-sm" style={{color:'var(--muted)'}}>Loading biography...</div>
          )}

          {archaeology && !loadingArch && (
            <div className="space-y-3">
              <div className="rounded-xl p-3 border border-blue-500/20"
                style={{background:'rgba(59,130,246,0.05)'}}>
                <p className="text-sm font-medium text-blue-400">{archaeology.name}</p>
                <p className="text-xs mt-0.5" style={{color:'var(--muted)'}}>
                  {archaeology.necessity_tier} · {fmt(archaeology.alloc_value)}/cycle allocation
                </p>
              </div>

              <div className="space-y-2">
                {archaeology.history.map((h: any, i: number) => (
                  <div key={i} className="rounded-xl p-3 border"
                    style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-sm font-medium" style={{color:'var(--text)'}}>{h.cycle}</p>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${
                        h.pct_used > 100 ? "bg-red-500/20 text-red-400" :
                        h.pct_used > 80 ? "bg-yellow-500/20 text-yellow-400" :
                        "bg-green-500/20 text-green-400"
                      }`}>
                        {h.pct_used}% used
                      </span>
                    </div>
                    <div className="w-full rounded-full h-1.5 mb-2" style={{background:'var(--bg3)'}}>
                      <div className="h-1.5 rounded-full transition-all"
                        style={{
                          width:`${Math.min(h.pct_used, 100)}%`,
                          background: h.pct_used > 100 ? '#ef4444' : h.pct_used > 80 ? '#eab308' : '#22c55e'
                        }} />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <div>
                        <p className="text-xs" style={{color:'var(--muted)'}}>Allocated</p>
                        <p className="text-xs font-medium" style={{color:'var(--text)'}}>{fmt(h.allocated)}</p>
                      </div>
                      <div>
                        <p className="text-xs" style={{color:'var(--muted)'}}>Spent</p>
                        <p className="text-xs font-medium text-red-400">{fmt(h.spent)}</p>
                      </div>
                      <div>
                        <p className="text-xs" style={{color:'var(--muted)'}}>Surplus</p>
                        <p className={`text-xs font-medium ${h.surplus >= 0 ? "text-green-400" : "text-red-400"}`}>
                          {fmt(h.surplus)}
                        </p>
                      </div>
                    </div>
                    {h.tx_count > 0 && (
                      <p className="text-xs mt-1.5" style={{color:'var(--muted)'}}>
                        {h.tx_count} transaction{h.tx_count !== 1 ? "s" : ""}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ============================================================
// LEDGER MEMORY — immutable financial autobiography
// ============================================================
function LedgerMemory() {
  const [memories, setMemories] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [category, setCategory] = useState("life_event");
  const [metricValue, setMetricValue] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadMemories(); }, []);

  const loadMemories = async () => {
    try {
      const m = await invoke<any[]>("get_ledger_memory");
      setMemories(m);
    } catch {}
    finally { setLoading(false); }
  };

  const addMemory = async () => {
    if (!title) return;
    setSaving(true);
    try {
      await invoke("add_ledger_memory", {
        title,
        description: description || null,
        category,
        metricValue: metricValue ? parseFloat(metricValue) : null,
      });
      setTitle(""); setDescription(""); setMetricValue("");
      setShowForm(false);
      await loadMemories();
    } catch (e) { console.error(e); }
    finally { setSaving(false); }
  };

  const categoryIcon: Record<string, string> = {
    savings: "◎", floor_change: "▲", budget: "≡",
    income: "↑", behavior: "◈", life_event: "★"
  };

  if (loading) return <div className="p-4 text-sm" style={{color:'var(--muted)'}}>Loading memory...</div>;

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wider" style={{color:'var(--muted)'}}>Ledger memory</p>
          <p className="text-xs mt-0.5" style={{color:'var(--muted)'}}>Your financial autobiography — immutable</p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-all"
        >
          + Add event
        </button>
      </div>

      {showForm && (
        <div className="rounded-xl p-3 border space-y-3"
          style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
          <input
            type="text" value={title} onChange={(e) => setTitle(e.target.value)}
            placeholder="Event title (e.g. First internship income)"
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}}
          />
          <input
            type="text" value={description} onChange={(e) => setDescription(e.target.value)}
            placeholder="Notes (optional)"
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}}
          />
          <div className="grid grid-cols-2 gap-2">
            <select value={category} onChange={(e) => setCategory(e.target.value)}
              className="rounded-lg px-3 py-2 text-sm outline-none"
              style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}}>
              <option value="life_event">Life event</option>
              <option value="income">Income milestone</option>
              <option value="savings">Savings milestone</option>
              <option value="floor_change">Floor change</option>
              <option value="behavior">Behavior change</option>
              <option value="budget">Budget milestone</option>
            </select>
            <input
              type="number" value={metricValue} onChange={(e) => setMetricValue(e.target.value)}
              placeholder="Amount (optional)"
              className="rounded-lg px-3 py-2 text-sm outline-none"
              style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}}
            />
          </div>
          <div className="flex gap-2">
            <button onClick={() => setShowForm(false)}
              className="flex-1 py-2 rounded-lg text-sm"
              style={{background:'var(--bg3)', color:'var(--muted)'}}>
              Cancel
            </button>
            <button onClick={addMemory} disabled={saving || !title}
              className="flex-1 py-2 rounded-lg text-sm text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 transition-all">
              {saving ? "Saving..." : "Save to memory"}
            </button>
          </div>
        </div>
      )}

      {memories.length === 0 && !showForm ? (
        <div className="rounded-xl p-6 border text-center"
          style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
          <p className="text-sm" style={{color:'var(--muted)'}}>No memories yet.</p>
          <p className="text-xs mt-1" style={{color:'var(--muted)'}}>
            Mark significant financial events to build your autobiography.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {memories.map((m) => (
            <div key={m.id} className="rounded-xl p-3 border"
              style={{background:'var(--bg2)', borderColor: m.is_pinned ? 'rgba(59,130,246,0.4)' : 'var(--border)'}}>
              <div className="flex items-start gap-3">
                <span className="text-lg flex-shrink-0">
                  {categoryIcon[m.category] ?? "★"}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium" style={{color:'var(--text)'}}>{m.title}</p>
                  {m.description && (
                    <p className="text-xs mt-0.5" style={{color:'var(--muted)'}}>{m.description}</p>
                  )}
                  <div className="flex items-center gap-2 mt-1 flex-wrap">
                    <span className="text-xs capitalize" style={{color:'var(--muted)'}}>{m.category.replace("_"," ")}</span>
                    {m.metric_value && (
                      <span className="text-xs text-blue-400">{fmt(m.metric_value)}</span>
                    )}
                    {m.life_stage && (
                      <span className="text-xs" style={{color:'var(--muted)'}}>{m.life_stage}</span>
                    )}
                    <span className="text-xs" style={{color:'var(--muted)'}}>
                      {m.occurred_at.split("T")[0]}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
// ============================================================
// HABIT COMPOUND TRACKER
// ============================================================
function HabitCompound() {
  const [habits, setHabits] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    invoke<any[]>("get_habit_compounds")
      .then(setHabits)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="p-4 text-sm" style={{color:'var(--muted)'}}>Analysing habits...</div>;

  const totalAnnual = habits.reduce((a, h) => a + h.annual_cost, 0);

  return (
    <div className="p-4 space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wider" style={{color:'var(--muted)'}}>Habit compound tracker</p>
        <p className="text-xs mt-0.5" style={{color:'var(--muted)'}}>
          What your recurring expenses actually cost per year
        </p>
      </div>

      {habits.length === 0 ? (
        <div className="rounded-xl p-6 border text-center"
          style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
          <p className="text-sm" style={{color:'var(--muted)'}}>Log more transactions across multiple cycles to detect habits.</p>
        </div>
      ) : (
        <>
          {/* Total annual summary */}
          <div className="rounded-xl p-4 border border-blue-500/20"
            style={{background:'rgba(59,130,246,0.05)'}}>
            <p className="text-xs" style={{color:'var(--muted)'}}>Total projected annual spend</p>
            <p className="text-2xl font-semibold text-blue-400 mt-1">{fmt(totalAnnual)}</p>
            <p className="text-xs mt-1" style={{color:'var(--muted)'}}>
              Across {habits.length} recurring categories — if current patterns hold
            </p>
          </div>

          {/* Habit list */}
          <div className="space-y-2">
            {habits.map((h, i) => (
              <div key={i} className="rounded-xl border overflow-hidden"
                style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
                <div className="px-4 pt-3 pb-2">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <p className="text-sm font-medium" style={{color:'var(--text)'}}>{h.category}</p>
                      <p className="text-xs" style={{color:'var(--muted)'}}>
                        {h.tx_count} transactions · avg {fmt(h.avg_amount)} each
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold text-orange-400">{fmt(h.annual_cost)}/yr</p>
                      <p className="text-xs" style={{color:'var(--muted)'}}>{fmt(h.monthly_cost)}/mo</p>
                    </div>
                  </div>

                  {/* Annual cost bar — proportion of total */}
                  <div className="w-full rounded-full h-1" style={{background:'var(--bg3)'}}>
                    <div
                      className="h-1 rounded-full bg-orange-400 transition-all"
                      style={{width:`${Math.min((h.annual_cost / totalAnnual) * 100, 100)}%`}}
                    />
                  </div>

                  <div className="flex justify-between mt-1.5">
                    <span className="text-xs" style={{color:'var(--muted)'}}>
                      {((h.annual_cost / totalAnnual) * 100).toFixed(0)}% of annual recurring spend
                    </span>
                    <span className="text-xs" style={{color:'var(--muted)'}}>
                      range {fmt(h.min_amount)}–{fmt(h.max_amount)}
                    </span>
                  </div>
                </div>

                {/* Compound insight */}
                <div className="px-4 pb-3">
                  <p className="text-xs" style={{color:'var(--muted)'}}>
                    {h.annual_cost > 5000
                      ? `⚠ ${fmt(h.annual_cost)} per year is significant. Worth reviewing if this category is delivering real value.`
                      : h.annual_cost > 2000
                      ? `This adds up to ${fmt(h.annual_cost)} annually. Small but consistent.`
                      : `Low annual impact — ${fmt(h.annual_cost)}/year.`
                    }
                  </p>
                </div>
              </div>
            ))}
          </div>

          <p className="text-xs px-1" style={{color:'var(--muted)'}}>
            Projections assume current frequency continues. Based on your actual transaction history.
          </p>
        </>
      )}
    </div>
  );
}
// ============================================================
// MPC TREND CHART
// ============================================================
function MpcTrend() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    invoke<any[]>("get_mpc_trend")
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const d = payload[0].payload;
      return (
        <div className="rounded-xl px-3 py-2 border text-xs space-y-1"
          style={{background:'var(--bg2)', borderColor:'var(--border)', color:'var(--text)'}}>
          <p className="font-medium">{d.label}</p>
          <p style={{color:'var(--muted)'}}>Income: {fmt(d.income)}</p>
          <p style={{color:'var(--muted)'}}>Expense: {fmt(d.expense)}</p>
          <p style={{color:'var(--muted)'}}>Net: {fmt(d.net)}</p>
          <p className={d.mpc < 0.7 ? "text-green-400" : d.mpc < 0.9 ? "text-yellow-400" : "text-red-400"}>
            MPC: {d.mpc_pct}%
          </p>
        </div>
      );
    }
    return null;
  };

  if (loading) return <div className="p-4 text-sm" style={{color:'var(--muted)'}}>Loading trend...</div>;

  return (
    <div className="p-4 space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wider" style={{color:'var(--muted)'}}>MPC trend</p>
        <p className="text-xs mt-0.5" style={{color:'var(--muted)'}}>
          Your marginal propensity to consume across cycles — Keynes made personal
        </p>
      </div>

      {data.length < 2 ? (
        <div className="rounded-xl p-6 border text-center"
          style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
          <p className="text-sm" style={{color:'var(--muted)'}}>Need at least 2 cycles to show a trend.</p>
          <p className="text-xs mt-1" style={{color:'var(--muted)'}}>Complete your current cycle and start a new one.</p>
        </div>
      ) : (
        <>
          {/* MPC chart */}
          <div className="rounded-xl p-4 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
            <p className="text-xs mb-3" style={{color:'var(--muted)'}}>MPC % per cycle (lower = better)</p>
            <ResponsiveContainer width="100%" height={180}>
              <LineChart data={data} margin={{top:8, right:8, bottom:8, left:8}}>
                <XAxis dataKey="label" tick={{fontSize:10, fill:'var(--muted)'}}
                  axisLine={false} tickLine={false} />
                <YAxis tick={{fontSize:10, fill:'var(--muted)'}}
                  axisLine={false} tickLine={false}
                  tickFormatter={(v) => `${v}%`} width={35} domain={[0, 100]} />
                <Tooltip content={<CustomTooltip />} />
                <ReferenceLine y={70} stroke="#eab308" strokeDasharray="4 4" />
                <ReferenceLine y={90} stroke="#ef4444" strokeDasharray="4 4" />
                <Line type="monotone" dataKey="mpc_pct" stroke="#3b82f6"
                  strokeWidth={2} dot={{r:4, fill:'#3b82f6'}} activeDot={{r:5}} />
              </LineChart>
            </ResponsiveContainer>
            <div className="flex gap-4 mt-2">
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-0.5 bg-yellow-400" style={{borderTop:'2px dashed'}} />
                <span className="text-xs" style={{color:'var(--muted)'}}>Caution (70%)</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="w-3 h-0.5 bg-red-400" style={{borderTop:'2px dashed'}} />
                <span className="text-xs" style={{color:'var(--muted)'}}>Critical (90%)</span>
              </div>
            </div>
          </div>

          {/* Net saved chart */}
          <div className="rounded-xl p-4 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
            <p className="text-xs mb-3" style={{color:'var(--muted)'}}>Net saved per cycle</p>
            <ResponsiveContainer width="100%" height={150}>
              <LineChart data={data} margin={{top:8, right:8, bottom:8, left:8}}>
                <XAxis dataKey="label" tick={{fontSize:10, fill:'var(--muted)'}}
                  axisLine={false} tickLine={false} />
                <YAxis tick={{fontSize:10, fill:'var(--muted)'}}
                  axisLine={false} tickLine={false}
                  tickFormatter={(v) => `₹${(v/1000).toFixed(0)}k`} width={40} />
                <Tooltip content={<CustomTooltip />} />
                <ReferenceLine y={0} stroke="var(--border)" strokeDasharray="4 4" />
                <Line type="monotone" dataKey="net"
                  stroke="#22c55e" strokeWidth={2}
                  dot={{r:4, fill:'#22c55e'}} activeDot={{r:5}} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Per cycle table */}
          <div>
            <p className="text-xs uppercase tracking-wider mb-2" style={{color:'var(--muted)'}}>Cycle breakdown</p>
            <div className="space-y-2">
              {data.map((d, i) => (
                <div key={i} className="rounded-xl p-3 border"
                  style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-medium" style={{color:'var(--text)'}}>{d.label}</p>
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      d.mpc < 0.5 ? "bg-green-500/20 text-green-400" :
                      d.mpc < 0.7 ? "bg-blue-500/20 text-blue-400" :
                      d.mpc < 0.9 ? "bg-yellow-500/20 text-yellow-400" :
                      "bg-red-500/20 text-red-400"
                    }`}>
                      MPC {d.mpc_pct}%
                    </span>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <p className="text-xs" style={{color:'var(--muted)'}}>Income</p>
                      <p className="text-xs font-medium text-green-400">{fmt(d.income)}</p>
                    </div>
                    <div>
                      <p className="text-xs" style={{color:'var(--muted)'}}>Expense</p>
                      <p className="text-xs font-medium text-red-400">{fmt(d.expense)}</p>
                    </div>
                    <div>
                      <p className="text-xs" style={{color:'var(--muted)'}}>Net</p>
                      <p className={`text-xs font-medium ${d.net >= 0 ? "text-blue-400" : "text-red-400"}`}>
                        {fmt(d.net)}
                      </p>
                    </div>
                  </div>
                  {d.impulse_count > 0 && (
                    <p className="text-xs mt-1.5 text-yellow-400">
                      {d.impulse_count} impulse {d.impulse_count === 1 ? "purchase" : "purchases"} — {fmt(d.impulse_total)}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
// ============================================================
// WEEKLY FINANCIAL LETTER
// ============================================================
function WeeklyLetter() {
  const [letters, setLetters] = useState<any[]>([]);
  const [generating, setGenerating] = useState(false);
  const [currentLetter, setCurrentLetter] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadLetters();
  }, []);

  const loadLetters = async () => {
    try {
      const l = await invoke<any[]>("get_weekly_letters");
      setLetters(l);
    } catch {}
    finally { setLoading(false); }
  };

  const generate = async () => {
    setGenerating(true);
    setCurrentLetter("");
    try {
      const letter = await invoke<string>("generate_weekly_letter");
      setCurrentLetter(letter);
      await loadLetters();
    } catch (e) {
      setCurrentLetter("Error: Make sure Ollama is running with qwen2.5:7b loaded.");
    } finally {
      setGenerating(false);
    }
  };

  if (loading) return <div className="p-4 text-sm" style={{color:'var(--muted)'}}>Loading...</div>;

  return (
    <div className="p-4 space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wider" style={{color:'var(--muted)'}}>Weekly financial letter</p>
        <p className="text-xs mt-0.5" style={{color:'var(--muted)'}}>
          A personal, honest narrative of your finances — written by your AI
        </p>
      </div>

      <button
        onClick={generate}
        disabled={generating}
        className="w-full py-3 rounded-xl text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 transition-all"
      >
        {generating ? "Writing your letter..." : "Generate this week's letter"}
      </button>

      {generating && (
        <div className="rounded-xl p-4 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
          <div className="flex items-center gap-2 mb-2">
            {[0,150,300].map((d) => (
              <div key={d} className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce"
                style={{animationDelay:`${d}ms`}} />
            ))}
            <span className="text-xs" style={{color:'var(--muted)'}}>Cistern is writing...</span>
          </div>
        </div>
      )}

      {currentLetter && !generating && (
        <div className="rounded-xl p-4 border border-blue-500/20"
          style={{background:'rgba(59,130,246,0.05)'}}>
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-medium text-blue-400">This week's letter</p>
            <p className="text-xs" style={{color:'var(--muted)'}}>Just generated</p>
          </div>
          <div className="text-sm leading-relaxed prose prose-invert prose-sm max-w-none"
            style={{color:'var(--text)'}}>
            <ReactMarkdown>{currentLetter}</ReactMarkdown>
          </div>
        </div>
      )}

      {letters.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-wider mb-2" style={{color:'var(--muted)'}}>Past letters</p>
          <div className="space-y-2">
            {letters.map((l, i) => (
              <details key={l.id} className="rounded-xl border overflow-hidden"
                style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
                <summary className="px-4 py-3 cursor-pointer text-sm font-medium"
                  style={{color:'var(--text)'}}>
                  <span>{i === 0 ? "Latest letter" : `Letter ${letters.length - i}`}</span>
                  <span className="text-xs ml-2" style={{color:'var(--muted)'}}>
                    {l.generated_at.split("T")[0]}
                  </span>
                </summary>
                <div className="px-4 pb-4 text-sm leading-relaxed prose prose-invert prose-sm max-w-none"
                  style={{color:'var(--text)'}}>
                  <ReactMarkdown>{l.body}</ReactMarkdown>
                </div>
              </details>
            ))}
          </div>
        </div>
      )}

      {letters.length === 0 && !currentLetter && !generating && (
        <div className="rounded-xl p-6 border text-center"
          style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
          <p className="text-sm" style={{color:'var(--muted)'}}>No letters yet.</p>
          <p className="text-xs mt-1" style={{color:'var(--muted)'}}>
            Generate your first letter above. Log more transactions for richer analysis.
          </p>
        </div>
      )}
    </div>
  );
}
// ============================================================
// SCENARIO SIMULATOR
// ============================================================
function ScenarioSimulator() {
  const [categories, setCategories] = useState<string[]>([]);
  const [cutCategory, setCutCategory] = useState("");
  const [cutPercent, setCutPercent] = useState("20");
  const [extraIncome, setExtraIncome] = useState("");
  const [extraExpense, setExtraExpense] = useState("");
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    invoke<any[]>("get_transactions", { limit: 200 }).then((txs) => {
      const cats = [...new Set(txs.filter((t) => t.type === "expense").map((t) => t.category))];
      setCategories(cats);
      if (cats.length > 0) setCutCategory(cats[0]);
    }).catch(() => {});
  }, []);

  const run = async () => {
    setLoading(true);
    try {
      const res = await invoke<any>("run_scenario", {
        cutCategory: cutCategory || null,
        cutPercent: cutCategory ? parseFloat(cutPercent) : null,
        extraIncome: extraIncome ? parseFloat(extraIncome) : null,
        extraExpense: extraExpense ? parseFloat(extraExpense) : null,
      });
      setResult(res);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const DeltaBadge = ({ value, higherIsBetter = true }: { value: number; higherIsBetter?: boolean }) => {
    if (Math.abs(value) < 0.01) return <span className="text-xs" style={{color:'var(--muted)'}}>No change</span>;
    const good = higherIsBetter ? value > 0 : value < 0;
    return (
      <span className={`text-xs font-medium ${good ? "text-green-400" : "text-red-400"}`}>
        {value > 0 ? "+" : ""}{fmt(value)}
      </span>
    );
  };

  return (
    <div className="p-4 space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wider" style={{color:'var(--muted)'}}>Scenario simulator</p>
        <p className="text-xs mt-0.5" style={{color:'var(--muted)'}}>What if — model changes on your real data</p>
      </div>

      {/* Cut spending */}
      <div className="rounded-xl p-3 border space-y-3" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
        <p className="text-xs font-medium" style={{color:'var(--text)'}}>What if I cut a category?</p>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs block mb-1" style={{color:'var(--muted)'}}>Category</label>
            <select
              value={cutCategory}
              onChange={(e) => setCutCategory(e.target.value)}
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}}
            >
              <option value="">None</option>
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs block mb-1" style={{color:'var(--muted)'}}>Cut by %</label>
            <input
              type="number"
              value={cutPercent}
              onChange={(e) => setCutPercent(e.target.value)}
              min="1" max="100"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}}
            />
          </div>
        </div>
      </div>

      {/* Extra income */}
      <div className="rounded-xl p-3 border space-y-2" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
        <p className="text-xs font-medium" style={{color:'var(--text)'}}>What if I get extra income?</p>
        <input
          type="number"
          value={extraIncome}
          onChange={(e) => setExtraIncome(e.target.value)}
          placeholder="e.g. 3000"
          className="w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}}
        />
      </div>

      {/* Extra expense */}
      <div className="rounded-xl p-3 border space-y-2" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
        <p className="text-xs font-medium" style={{color:'var(--text)'}}>What if I have an unexpected expense?</p>
        <input
          type="number"
          value={extraExpense}
          onChange={(e) => setExtraExpense(e.target.value)}
          placeholder="e.g. 2000"
          className="w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}}
        />
      </div>

      <button
        onClick={run}
        disabled={loading}
        className="w-full py-3 rounded-xl text-sm font-medium text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 transition-all"
      >
        {loading ? "Running simulation..." : "Run scenario"}
      </button>

      {/* Results */}
      {result && (
        <div className="space-y-3">
          <p className="text-xs uppercase tracking-wider" style={{color:'var(--muted)'}}>Simulation results</p>

          {/* Summary cards */}
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: "Net saved", base: result.baseline.net, sim: result.simulated.net, delta: result.delta.net, good: true },
              { label: "Balance", base: result.baseline.balance, sim: result.simulated.balance, delta: result.delta.balance, good: true },
              { label: "Runway", base: result.baseline.runway_days, sim: result.simulated.runway_days, delta: result.delta.runway_days, good: true, days: true },
              { label: "MPC", base: result.baseline.mpc, sim: result.simulated.mpc, delta: result.delta.mpc, good: false, pct: true },
            ].map((m) => (
              <div key={m.label} className="rounded-xl p-3 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
                <p className="text-xs mb-1" style={{color:'var(--muted)'}}>{m.label}</p>
                <p className="text-sm font-medium" style={{color:'var(--text)'}}>
                  {m.days ? `${m.sim.toFixed(0)} days` : m.pct ? `${(m.sim * 100).toFixed(0)}%` : fmt(m.sim)}
                </p>
                <div className="text-xs mt-0.5" style={{color:'var(--muted)'}}>
                  was {m.days ? `${m.base.toFixed(0)}d` : m.pct ? `${(m.base * 100).toFixed(0)}%` : fmt(m.base)}
                  {" · "}
                  {m.days
                    ? <span className={m.delta > 0 ? "text-green-400" : "text-red-400"}>{m.delta > 0 ? "+" : ""}{m.delta.toFixed(0)}d</span>
                    : m.pct
                    ? <span className={m.good ? (m.delta < 0 ? "text-green-400" : "text-red-400") : (m.delta > 0 ? "text-green-400" : "text-red-400")}>{m.delta > 0 ? "+" : ""}{(m.delta * 100).toFixed(1)}%</span>
                    : <DeltaBadge value={m.delta} higherIsBetter={m.good} />
                  }
                </div>
              </div>
            ))}
          </div>

          {/* Cut detail */}
          {result.cut_saving > 0 && (
            <div className="rounded-xl p-3 border border-green-500/20" style={{background:'rgba(34,197,94,0.05)'}}>
              <p className="text-xs font-medium text-green-400 mb-1">Spending cut impact</p>
              <p className="text-xs" style={{color:'var(--muted)'}}>
                Cutting {cutPercent}% from {cutCategory} saves {fmt(result.cut_saving)} this cycle.
                That's {fmt(result.cut_saving * 12)} annually if sustained.
              </p>
            </div>
          )}

          {/* Verdict */}
          <div className="rounded-xl p-3 border border-blue-500/20" style={{background:'rgba(59,130,246,0.05)'}}>
            <p className="text-xs font-medium mb-1" style={{color:'var(--text)'}}>Verdict</p>
            <p className="text-xs" style={{color:'var(--muted)'}}>
              {result.delta.net > 0
                ? `This scenario improves your net position by ${fmt(result.delta.net)} and extends your runway by ${result.delta.runway_days.toFixed(0)} days.`
                : result.delta.net < 0
                ? `This scenario reduces your net position by ${fmt(Math.abs(result.delta.net))} and shortens your runway by ${Math.abs(result.delta.runway_days).toFixed(0)} days.`
                : "This scenario has no net impact on your finances."}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
// ============================================================
// BACKUP & RESTORE
// ============================================================
function BackupRestore() {
  const [backing, setBacking] = useState(false);
  const [msg, setMsg] = useState("");
  const [dbPath, setDbPath] = useState("");
  const [backupPath, setBackupPath] = useState("");

  useEffect(() => {
    invoke<string>("get_db_path")
      .then(setDbPath)
      .catch(() => {});
    const date = new Date().toISOString().split("T")[0];
    downloadDir()
      .then((dir) => join(dir, `cistern_backup_${date}.db`))
      .then(setBackupPath)
      .catch(() => {});
  }, []);

  const doBackup = async () => {
    if (!backupPath.trim()) return;
    setBacking(true);
    setMsg("");
    try {
      const result = await invoke<string>("backup_database", { backupPath: backupPath.trim() });
      setMsg(`✓ Backup saved to ${result}`);
    } catch (e) {
      setMsg("Error: " + e);
    } finally {
      setBacking(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wider" style={{color:'var(--muted)'}}>Backup & restore</p>
        <p className="text-xs mt-0.5" style={{color:'var(--muted)'}}>One-click backup of your entire database</p>
      </div>

      {/* Live database location */}
      <div className="rounded-xl p-3 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
        <p className="text-xs font-medium mb-1" style={{color:'var(--text)'}}>Live database location</p>
        <p className="text-xs font-mono break-all" style={{color:'var(--muted)'}}>{dbPath || "Loading..."}</p>
        <p className="text-xs mt-2" style={{color:'var(--muted)'}}>
          This file contains your entire financial history. Keep it safe.
        </p>
      </div>

      {/* Backup path */}
      <div className="rounded-xl p-3 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
        <label className="text-xs block mb-1" style={{color:'var(--muted)'}}>Backup destination</label>
        <input
          type="text"
          value={backupPath}
          onChange={(e) => setBackupPath(e.target.value)}
          className="w-full rounded-lg px-3 py-2 text-sm outline-none mt-1 font-mono"
          style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}}
        />
        <p className="text-xs mt-1.5" style={{color:'var(--muted)'}}>
          Change this to any folder — external drive, another directory, anywhere you control.
        </p>
      </div>

      <button
        onClick={doBackup}
        disabled={backing}
        className="w-full py-3 rounded-xl text-sm font-medium text-white bg-blue-700 hover:bg-blue-600 disabled:opacity-50 transition-all"
      >
        {backing ? "Backing up..." : "Create backup"}
      </button>

      {msg && (
        <div className={`rounded-xl p-3 border text-sm ${
          msg.startsWith("✓")
            ? "border-green-500/30 bg-green-500/10 text-green-300"
            : "border-red-500/30 bg-red-500/10 text-red-300"
        }`}>
          {msg}
        </div>
      )}

      {/* Restore instructions */}
      <div className="rounded-xl p-3 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
        <p className="text-xs font-medium mb-2" style={{color:'var(--text)'}}>How to restore a backup</p>
        {[
          "Close Cistern completely",
          "Navigate to your live database folder (shown above)",
          "Replace cistern.db with your backup file",
          "Rename the backup file to cistern.db",
          "Reopen Cistern — all data restored",
        ].map((step, i) => (
          <div key={i} className="flex items-start gap-2 py-1">
            <span className="text-xs font-medium text-blue-400 min-w-4">{i + 1}.</span>
            <span className="text-xs" style={{color:'var(--muted)'}}>{step}</span>
          </div>
        ))}
      </div>

      <p className="text-xs px-1" style={{color:'var(--muted)'}}>
        The backup is a complete copy of your SQLite database. Open it with DBeaver or any SQLite viewer to inspect directly.
      </p>
    </div>
  );
}
// ============================================================
// EXPORT DATA
// ============================================================
function ExportData() {
  const [exporting, setExporting] = useState(false);
  const [msg, setMsg] = useState("");
  const [exportPath, setExportPath] = useState("");

  const [dlDir, setDlDir] = useState("");

  useEffect(() => {
    downloadDir().then(setDlDir).catch(() => {});
  }, []);

  const getDefaultPath = (ext: string) => {
    const date = new Date().toISOString().split("T")[0];
    return `${dlDir.replace(/[\\/]+$/, "")}/cistern_${date}.${ext}`;
  };

  const doExport = async (format: "csv" | "json") => {
    const path = exportPath.trim() || getDefaultPath(format);
    setExporting(true);
    setMsg("");
    try {
      const result = await invoke<string>(
        format === "csv" ? "export_transactions_csv" : "export_transactions_json",
        { path }
      );
      setMsg(`✓ Exported to ${result}`);
    } catch (e) {
      setMsg("Error: " + e);
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wider" style={{color:'var(--muted)'}}>Export your data</p>
        <p className="text-xs mt-0.5" style={{color:'var(--muted)'}}>Your data is yours — export anytime in open formats</p>
      </div>

      {/* Path input */}
      <div className="rounded-xl p-3 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
        <label className="text-xs block mb-1" style={{color:'var(--muted)'}}>
          Export path (leave blank for Downloads folder)
        </label>
        <input
          type="text"
          value={exportPath}
          onChange={(e) => setExportPath(e.target.value)}
          placeholder={getDefaultPath("csv")}
          className="w-full rounded-lg px-3 py-2 text-sm outline-none mt-1"
          style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}}
        />
      </div>

      {/* Export buttons */}
      <div className="space-y-2">
        <button
          onClick={() => doExport("csv")}
          disabled={exporting}
          className="w-full py-3 rounded-xl text-sm font-medium text-white bg-green-700 hover:bg-green-600 disabled:opacity-50 transition-all"
        >
          <p className="font-medium">Export as CSV</p>
          <p className="text-xs text-green-200 mt-0.5">Open in Excel, Google Sheets, any spreadsheet app</p>
        </button>

        <button
          onClick={() => doExport("json")}
          disabled={exporting}
          className="w-full py-3 rounded-xl text-sm font-medium text-white bg-blue-700 hover:bg-blue-600 disabled:opacity-50 transition-all"
        >
          <p className="font-medium">Export as JSON</p>
          <p className="text-xs text-blue-200 mt-0.5">Machine-readable, for developers or backup</p>
        </button>
      </div>

      {msg && (
        <div className={`rounded-xl p-3 border text-sm ${
          msg.startsWith("✓")
            ? "border-green-500/30 bg-green-500/10 text-green-300"
            : "border-red-500/30 bg-red-500/10 text-red-300"
        }`}>
          {msg}
        </div>
      )}

      {/* What gets exported */}
      <div className="rounded-xl p-3 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
        <p className="text-xs font-medium mb-2" style={{color:'var(--text)'}}>What gets exported</p>
        {[
          "Every transaction — amount, date, category, type",
          "Necessity tier and planned/impulse flag",
          "Bucket and income source names",
          "Notes and descriptions",
          "Cycle labels",
        ].map((item) => (
          <div key={item} className="flex items-center gap-2 py-1">
            <span className="text-green-400 text-xs">✓</span>
            <span className="text-xs" style={{color:'var(--muted)'}}>{item}</span>
          </div>
        ))}
      </div>

      <p className="text-xs px-1" style={{color:'var(--muted)'}}>
        Exported files are plain text — readable without Cistern. No lock-in, ever.
      </p>
    </div>
  );
}
// ============================================================
// SAVINGS TARGETS
// ============================================================
function SavingsTargets({ onSuccess }: { onSuccess: () => void }) {
  const [targets, setTargets] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [targetAmount, setTargetAmount] = useState("");
  const [deadline, setDeadline] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [suggestion, setSuggestion] = useState<any>(null);
  const [applying, setApplying] = useState(false);

  const [editing, setEditing] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editAmount, setEditAmount] = useState("");
  const [editDeadline, setEditDeadline] = useState("");
  const [confirmDelete, setConfirmDelete] = useState<number | null>(null);

  const [viewingId, setViewingId] = useState<number | null>(null);
  const [log, setLog] = useState<any[]>([]);
  const [contribution, setContribution] = useState("");

  const loadTargets = async () => {
    try {
      const t = await invoke<any[]>("get_savings_targets");
      setTargets(t);
      const s = await invoke<any>("get_smart_savings_suggestion");
      setSuggestion(s);
    } catch {}
    finally { setLoading(false); }
  };

  useEffect(() => { loadTargets(); }, []);

  const createTarget = async () => {
    if (!name || !targetAmount) { setMsg("Name and amount required."); return; }
    setSaving(true);
    try {
      await invoke("add_savings_target", { name, targetAmount: parseFloat(targetAmount), deadline: deadline || null });
      setName(""); setTargetAmount(""); setDeadline("");
      setShowForm(false);
      await loadTargets();
      setMsg("✓ Target created!");
      setTimeout(() => setMsg(""), 2000);
    } catch (e) { setMsg("Error: " + e); }
    finally { setSaving(false); }
  };

  const startEdit = (t: any) => {
    setEditing(t.id); setEditName(t.name);
    setEditAmount(String(t.target_amount)); setEditDeadline(t.deadline || "");
  };

  const saveEdit = async (id: number) => {
    if (!editName || !editAmount) { setMsg("Name and amount required."); return; }
    setSaving(true);
    try {
      await invoke("update_savings_target", { id, name: editName, targetAmount: parseFloat(editAmount), deadline: editDeadline || null });
      setEditing(null);
      await loadTargets();
    } catch (e) { setMsg("Error: " + e); }
    finally { setSaving(false); }
  };

  const removeTarget = async (id: number) => {
    setSaving(true);
    try {
      await invoke("delete_savings_target", { id });
      setConfirmDelete(null);
      await loadTargets();
    } catch (e) { setMsg("Error: " + e); }
    finally { setSaving(false); }
  };

  const applySuggestion = async () => {
    if (!suggestion?.allocations?.length) return;
    setApplying(true);
    try {
      for (const a of suggestion.allocations) {
        await invoke("add_savings_contribution", { targetId: a.target_id, amount: a.suggested_amount });
      }
      setSuggestion(null);
      await loadTargets();
      onSuccess();
    } catch (e) { setMsg("Error: " + e); }
    finally { setApplying(false); }
  };

  const openDetail = async (id: number) => {
    setViewingId(id);
    try {
      const l = await invoke<any[]>("get_savings_contribution_log", { targetId: id });
      setLog(l);
    } catch { setLog([]); }
  };

  const addContribution = async () => {
    if (!contribution || !viewingId) return;
    setSaving(true);
    try {
      await invoke("add_savings_contribution", { targetId: viewingId, amount: parseFloat(contribution) });
      setContribution("");
      await loadTargets();
      await openDetail(viewingId);
      onSuccess();
    } catch (e) { setMsg("Error: " + e); }
    finally { setSaving(false); }
  };

  const removeContribution = async (contributionId: number) => {
    if (!viewingId) return;
    setSaving(true);
    try {
      await invoke("delete_savings_contribution", { contributionId });
      await loadTargets();
      await openDetail(viewingId);
      onSuccess();
    } catch (e) { setMsg("Error: " + e); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="p-4 text-sm" style={{color:'var(--muted)'}}>Loading...</div>;

  // ---- DETAIL VIEW ----
  if (viewingId) {
    const t = targets.find((x) => x.id === viewingId);
    if (!t) { setViewingId(null); return null; }
    return (
      <div className="p-4 space-y-4">
        <button onClick={() => setViewingId(null)} className="text-xs" style={{color:'var(--muted)'}}>← Back</button>
        <div>
          <p className="text-sm font-medium" style={{color:'var(--text)'}}>{t.name}</p>
          <p className="text-xs" style={{color:'var(--muted)'}}>{fmt(t.current_amount)} of {fmt(t.target_amount)} · {t.pct.toFixed(0)}% complete</p>
        </div>
        <div className="rounded-xl p-3 border space-y-2" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
          <input type="number" value={contribution} onChange={(e) => setContribution(e.target.value)}
            placeholder="Amount to add (₹) — moves real money from your balance"
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}} />
          {msg && <p className={`text-xs ${msg.startsWith("✓") ? "text-green-400" : "text-red-400"}`}>{msg}</p>}
          <button onClick={addContribution} disabled={saving} className="w-full py-2 rounded-lg text-sm text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50">
            {saving ? "Adding..." : "Add funds"}
          </button>
        </div>
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wider" style={{color:'var(--muted)'}}>Contribution log</p>
          {log.length === 0 ? (
            <p className="text-xs" style={{color:'var(--muted)'}}>Nothing added yet.</p>
          ) : log.map((c, i) => (
            <div key={i} className="rounded-lg p-2 border flex justify-between items-center" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
              <div>
                <p className="text-sm text-green-400">{fmt(c.amount)}</p>
                <p className="text-xs" style={{color:'var(--muted)'}}>{c.date}</p>
              </div>
              <button onClick={() => removeContribution(c.contribution_id ?? c.id)} className="text-xs text-red-400">Remove</button>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ---- LIST VIEW ----
  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wider" style={{color:'var(--muted)'}}>Savings targets</p>
          <p className="text-xs mt-0.5" style={{color:'var(--muted)'}}>Named goals with progress tracking</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-all">
          + New target
        </button>
      </div>

      {showForm && (
        <div className="rounded-xl p-4 border space-y-3" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Emergency fund, New laptop"
            className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}} />
          <input type="number" value={targetAmount} onChange={(e) => setTargetAmount(e.target.value)} placeholder="Target amount (₹)"
            className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}} />
          <input type="date" value={deadline} onChange={(e) => setDeadline(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}} />
          {msg && <p className={`text-xs ${msg.startsWith("✓") ? "text-green-400" : "text-red-400"}`}>{msg}</p>}
          <div className="flex gap-2">
            <button onClick={() => setShowForm(false)} className="flex-1 py-2 rounded-lg text-sm" style={{background:'var(--bg3)', color:'var(--muted)'}}>Cancel</button>
            <button onClick={createTarget} disabled={saving} className="flex-1 py-2 rounded-lg text-sm text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50">
              {saving ? "Creating..." : "Create"}
            </button>
          </div>
        </div>
      )}

      {suggestion && suggestion.surplus > 0 && suggestion.allocations?.length > 0 && (
        <div className="rounded-xl p-4 border border-blue-500/30" style={{background:'var(--bg2)'}}>
          <p className="text-sm font-medium text-blue-300 mb-1">Smart savings suggestion</p>
          <p className="text-xs mb-3" style={{color:'var(--muted)'}}>You have {fmt(suggestion.surplus)} above your survival floor:</p>
          <div className="space-y-1 mb-3">
            {suggestion.allocations.map((a: any) => (
              <div key={a.target_id} className="flex justify-between text-xs">
                <span style={{color:'var(--text)'}}>{a.target_name}</span>
                <span className="text-blue-400">{fmt(a.suggested_amount)}</span>
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={() => setSuggestion(null)} className="flex-1 py-2 rounded-lg text-xs" style={{background:'var(--bg3)', color:'var(--muted)'}}>Dismiss</button>
            <button onClick={applySuggestion} disabled={applying} className="flex-1 py-2 rounded-lg text-xs text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50">
              {applying ? "Applying..." : "Apply this split"}
            </button>
          </div>
        </div>
      )}
      {suggestion && suggestion.surplus > 0 && (!suggestion.allocations || suggestion.allocations.length === 0) && (
        <div className="rounded-xl p-3 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
          <p className="text-xs" style={{color:'var(--muted)'}}>You have {fmt(suggestion.surplus)} surplus but no active targets — staying in your buffer.</p>
        </div>
      )}
      {suggestion && suggestion.surplus === 0 && (
        <div className="rounded-xl p-3 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
          <p className="text-xs" style={{color:'var(--muted)'}}>No surplus above your survival floor right now — nothing to allocate.</p>
        </div>
      )}

      {targets.length === 0 && !showForm ? (
        <div className="text-center py-10 rounded-xl border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
          <p className="text-sm" style={{color:'var(--muted)'}}>No savings targets yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {targets.map((t) => (
            <div key={t.id} className="rounded-xl p-4 border" style={{background:'var(--bg2)', borderColor: t.is_completed ? 'rgba(34,197,94,0.3)' : 'var(--border)'}}>
              {editing === t.id ? (
                <div className="space-y-2 mb-2">
                  <input type="text" value={editName} onChange={(e) => setEditName(e.target.value)}
                    className="w-full rounded-lg px-2 py-1 text-sm outline-none" style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}} />
                  <input type="number" value={editAmount} onChange={(e) => setEditAmount(e.target.value)}
                    className="w-full rounded-lg px-2 py-1 text-sm outline-none" style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}} />
                  <input type="date" value={editDeadline} onChange={(e) => setEditDeadline(e.target.value)}
                    className="w-full rounded-lg px-2 py-1 text-sm outline-none" style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}} />
                  <div className="flex gap-2">
                    <button onClick={() => setEditing(null)} className="flex-1 py-1.5 rounded-lg text-xs" style={{background:'var(--bg3)', color:'var(--muted)'}}>Cancel</button>
                    <button onClick={() => saveEdit(t.id)} disabled={saving} className="flex-1 py-1.5 rounded-lg text-xs text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50">Save</button>
                  </div>
                </div>
              ) : (
                <div onClick={() => openDetail(t.id)} className="cursor-pointer">
                  <div className="flex items-start justify-between mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="text-sm font-medium" style={{color:'var(--text)'}}>{t.name}</p>
                        {t.is_completed && <span className="text-xs bg-green-500/20 text-green-400 px-2 py-0.5 rounded-full">✓ Done</span>}
                        <button onClick={(e) => { e.stopPropagation(); startEdit(t); }} className="text-xs" style={{color:'var(--muted)'}}>✎</button>
                        {confirmDelete === t.id ? (
                          <span className="text-xs flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                            <span style={{color:'var(--muted)'}}>Delete?</span>
                            <button onClick={() => removeTarget(t.id)} className="text-red-400">Yes</button>
                            <button onClick={() => setConfirmDelete(null)} style={{color:'var(--muted)'}}>No</button>
                          </span>
                        ) : (
                          <button onClick={(e) => { e.stopPropagation(); setConfirmDelete(t.id); }} className="text-xs" style={{color:'var(--muted)'}}>🗑</button>
                        )}
                      </div>
                      {t.deadline && <p className="text-xs mt-0.5" style={{color:'var(--muted)'}}>Due {t.deadline}</p>}
                    </div>
                    <div className="text-right ml-2">
                      <p className="text-sm font-semibold" style={{color:'var(--text)'}}>{fmt(t.current_amount)}</p>
                      <p className="text-xs" style={{color:'var(--muted)'}}>of {fmt(t.target_amount)}</p>
                    </div>
                  </div>
                  <div className="w-full rounded-full h-1.5 mb-1" style={{background:'var(--bg3)'}}>
                    <div className="h-1.5 rounded-full transition-all" style={{width: `${t.pct}%`, background: t.is_completed ? '#22c55e' : t.pct > 70 ? '#3b82f6' : '#6366f1'}} />
                  </div>
                  <div className="flex justify-between">
                    <span className="text-xs" style={{color:'var(--muted)'}}>{t.pct.toFixed(0)}% complete</span>
                    <span className="text-xs" style={{color:'var(--muted)'}}>tap to view log →</span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
// ============================================================
// CYCLE MANAGER SCREEN
// ============================================================
function CycleManager({ onCycleChange }: { onCycleChange: () => void }) {
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [closing, setClosing] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [phase, setPhase] = useState<"view" | "closing" | "opening" | "intentions">("view");
  const [msg, setMsg] = useState("");
  const [buckets, setBuckets] = useState<BucketHealth[]>([]);
  const [intentions, setIntentions] = useState<Record<number, string>>({});
  const [intentionProgress, setIntentionProgress] = useState<any[]>([]);

  useEffect(() => {
    Promise.all([
      invoke<any[]>("get_cycle_history"),
      invoke<BucketHealth[]>("get_bucket_health"),
    ]).then(([h, b]) => { setHistory(h); setBuckets(b); }).finally(() => setLoading(false));
    invoke<any[]>("get_intention_progress").then(setIntentionProgress);
  }, []);
      

  const currentCycle = history.find((c) => c.is_current);

  const handleClose = async () => {
    setClosing(true);
    try {
      await invoke("close_cycle");
      setMsg("✓ Cycle closed.");
      setPhase("opening");
      const now = new Date();
      setNewLabel(now.toLocaleString("en-IN", { month: "long", year: "numeric" }));
    } catch (e) {
      setMsg("Error: " + e);
    } finally {
      setClosing(false);
    }
  };

  const handleOpen = async () => {
    if (!newLabel) return;
    setClosing(true);
    try {
      await invoke("open_new_cycle", { label: newLabel });
      setMsg("✓ New cycle started: " + newLabel);
      setPhase("intentions");
      const updated = await invoke<any[]>("get_cycle_history");
      setHistory(updated);
      onCycleChange();
    } catch (e) {
      setMsg("Error: " + e);
    } finally {
      setClosing(false);
    }
  };
  const submitIntentions = async () => {
    const parsed: Record<number, number> = {};
    for (const [id, val] of Object.entries(intentions)) {
      if (val) parsed[parseInt(id)] = parseFloat(val);
    }
    try {
      await invoke("set_cycle_intentions", { intentions: parsed });
      setMsg("✓ Intentions locked in for this cycle.");
    } catch (e) {
      setMsg("Error: " + e);
    }
  };

  if (loading) return <div className="p-4 text-zinc-500 text-sm">Loading cycles...</div>;

  return (
    <div className="p-4 space-y-4">
      <p className="text-xs text-zinc-500 uppercase tracking-wider">Cycle management</p>

      {/* Current cycle card */}
      {currentCycle && phase === "view" && (
        <div className="bg-zinc-900 rounded-xl p-4 border border-blue-500/30">
          <div className="flex justify-between items-start mb-3">
            <div>
              <p className="text-xs text-blue-400 uppercase tracking-wider mb-1">Current cycle</p>
              <p className="text-lg font-semibold text-white">{currentCycle.label}</p>
              <p className="text-xs text-zinc-500">Started {currentCycle.start_date}</p>
            </div>
            <span className="text-xs bg-blue-500/20 text-blue-300 px-2 py-1 rounded-full">Active</span>
          </div>
          <div className="grid grid-cols-3 gap-2 mb-4">
            <div className="bg-zinc-800 rounded-lg p-2">
              <p className="text-xs text-zinc-500">Income</p>
              <p className="text-sm font-medium text-green-400">{fmt(currentCycle.total_income)}</p>
            </div>
            <div className="bg-zinc-800 rounded-lg p-2">
              <p className="text-xs text-zinc-500">Spent</p>
              <p className="text-sm font-medium text-red-400">{fmt(currentCycle.total_expense)}</p>
            </div>
            <div className="bg-zinc-800 rounded-lg p-2">
              <p className="text-xs text-zinc-500">Net</p>
              <p className={`text-sm font-medium ${currentCycle.net_position >= 0 ? "text-blue-400" : "text-red-400"}`}>
                {fmt(currentCycle.net_position)}
              </p>
            </div>
          </div>
          <button
            onClick={() => setPhase("closing")}
            className="w-full py-2.5 bg-zinc-800 hover:bg-zinc-700 text-white rounded-xl text-sm transition-all"
          >
            Close this cycle
          </button>
        </div>
      )}

      {intentionProgress.length > 0 && (
        <div className="mt-3 space-y-1">
          <p className="text-xs text-zinc-500 uppercase tracking-wider">Your intentions this cycle</p>
          {intentionProgress.map((p, i) => (
            <div key={i} className="flex justify-between text-xs">
              <span className="text-zinc-400">{p.bucket_name}</span>
              <span className={p.actual > p.intended ? "text-red-400" : "text-green-400"}>
                {fmt(p.actual)} / {fmt(p.intended)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Closing confirmation */}
      {phase === "closing" && (
        <div className="bg-zinc-900 rounded-xl p-4 border border-yellow-500/30">
          <p className="text-sm font-medium text-yellow-300 mb-2">Close current cycle?</p>
          <p className="text-xs text-zinc-400 mb-4">
            This will lock {currentCycle?.label} permanently. All totals will be recorded. You'll then open a new cycle.
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPhase("view")}
              className="flex-1 py-2 bg-zinc-800 text-zinc-400 rounded-xl text-sm"
            >
              Cancel
            </button>
            <button
              onClick={handleClose}
              disabled={closing}
              className="flex-1 py-2 bg-yellow-600 hover:bg-yellow-500 text-white rounded-xl text-sm transition-all"
            >
              {closing ? "Closing..." : "Confirm close"}
            </button>
          </div>
        </div>
      )}

      {/* Open new cycle */}
      {phase === "opening" && (
        <div className="bg-zinc-900 rounded-xl p-4 border border-green-500/30">
          <p className="text-sm font-medium text-green-300 mb-2">Start new cycle</p>
          <div className="mb-3">
            <label className="text-xs text-zinc-500 block mb-1">Cycle name</label>
            <input
              type="text"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-white outline-none focus:border-green-500/50"
            />
          </div>
          <button
            onClick={handleOpen}
            disabled={closing || !newLabel}
            className="w-full py-2.5 bg-green-700 hover:bg-green-600 disabled:bg-zinc-800 text-white rounded-xl text-sm transition-all"
          >
            {closing ? "Starting..." : "Start " + newLabel}
          </button>
        </div>
      )}
      {phase === "intentions" && (
  <div className="bg-zinc-900 rounded-xl p-4 border border-blue-500/30">
    <p className="text-sm font-medium text-blue-300 mb-1">Declare your intentions</p>
    <p className="text-xs text-zinc-400 mb-4">
      How much do you plan to spend from each bucket this cycle? At cycle end, we'll score how close you got.
    </p>
    <div className="space-y-2 mb-4">
      {buckets.map((b) => (
        <div key={b.id} className="flex items-center gap-2">
          <span className="text-sm flex-1" style={{color:'var(--text)'}}>{b.name}</span>
          <input
            type="number"
            value={intentions[b.id] || ""}
            onChange={(e) => setIntentions((i) => ({ ...i, [b.id]: e.target.value }))}
            placeholder={String(b.allocated)}
            className="w-24 rounded-lg px-2 py-1 text-sm outline-none"
            style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}}
          />
        </div>
      ))}
    </div>
    <div className="flex gap-2">
      <button onClick={() => { setPhase("view"); onCycleChange(); }} className="flex-1 py-2 bg-zinc-800 text-zinc-400 rounded-xl text-sm">
        Skip
      </button>
      <button onClick={async () => { await submitIntentions(); setPhase("view"); onCycleChange(); }} className="flex-1 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-sm">
        Lock in intentions
      </button>
    </div>
  </div>
)}

      {msg && <p className={`text-sm text-center ${msg.startsWith("✓") ? "text-green-400" : "text-red-400"}`}>{msg}</p>}

      {/* Cycle history */}
      <div>
        <p className="text-xs text-zinc-500 uppercase tracking-wider mb-2">Cycle history</p>
        <div className="space-y-2">
          {history.filter((c) => !c.is_current).map((c) => (
            <div key={c.id} className="bg-zinc-900 rounded-xl p-3 border border-zinc-800">
              <div className="flex justify-between items-center mb-2">
                <p className="text-sm font-medium text-white">{c.label}</p>
                <p className="text-xs text-zinc-500">{c.start_date} → {c.end_date}</p>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <p className="text-xs text-zinc-600">Income</p>
                  <p className="text-xs text-green-400">{fmt(c.total_income)}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-600">Spent</p>
                  <p className="text-xs text-red-400">{fmt(c.total_expense)}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-600">Net</p>
                  <p className={`text-xs ${c.net_position >= 0 ? "text-blue-400" : "text-red-400"}`}>
                    {fmt(c.net_position)}
                  </p>
                </div>
              </div>
              {c.accuracy_score != null && (
                <p className="text-xs mt-2" style={{color:'var(--muted)'}}>
                  Intention accuracy: <span className="text-blue-400 font-medium">{(c.accuracy_score * 100).toFixed(0)}%</span>
                </p>
              )}
            </div>
          ))}
          {history.filter((c) => !c.is_current).length === 0 && (
            <p className="text-xs text-zinc-600 text-center py-4">No closed cycles yet.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// ============================================================
// AI SCREEN — persistent threads, saved to SQLite
// ============================================================
interface Message {
  role: "user" | "ai";
  content: string;
  timestamp: string;
  thinking?: boolean;
}

interface AiThread {
  id: number;
  name: string;
  created_at: string;
  last_active: string;
}

// ============================================================
// AI SCREEN — persistent threads, rename, delete, saved to SQLite
// ============================================================
interface Message {
  role: "user" | "ai";
  content: string;
  timestamp: string;
  thinking?: boolean;
}

interface AiThread {
  id: number;
  name: string;
  created_at: string;
  last_active: string;
}

function AiChat({ }: { vitals: Vitals | null }) {
  const [threads, setThreads] = useState<AiThread[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<number | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [view, setView] = useState<"threads" | "chat">("threads");
  const [newThreadName, setNewThreadName] = useState("");
  const [creatingThread, setCreatingThread] = useState(false);
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { loadThreads(); }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const loadThreads = async () => {
    try {
      const t = await invoke<AiThread[]>("get_ai_threads");
      setThreads(t);
    } catch {}
  };

  const openThread = async (threadId: number) => {
    setActiveThreadId(threadId);
    setView("chat");
    try {
      const msgs = await invoke<any[]>("get_ai_thread", { threadId });
      setMessages(msgs.map((m) => ({
        role: m.role as "user" | "ai",
        content: m.content,
        timestamp: m.timestamp,
      })));
    } catch {}
    setTimeout(() => inputRef.current?.focus(), 100);
  };

  const createThread = async () => {
    const name = newThreadName.trim() || "New conversation";
    setCreatingThread(true);
    try {
      const id = await invoke<number>("create_ai_thread", { name });
      await loadThreads();
      setNewThreadName("");
      await openThread(id);
    } catch {}
    finally { setCreatingThread(false); }
  };

  const deleteThread = async (threadId: number, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await invoke("delete_ai_thread", { threadId });
      await loadThreads();
      if (activeThreadId === threadId) {
        setActiveThreadId(null);
        setMessages([]);
        setView("threads");
      }
    } catch {}
  };

  const renameThread = async (threadId: number) => {
    if (!renameValue.trim()) return;
    try {
      await invoke("rename_ai_thread", { threadId, name: renameValue.trim() });
      await loadThreads();
      setRenamingId(null);
    } catch {}
  };

  const send = async (text: string) => {
    if (!text.trim() || loading || !activeThreadId) return;

    const userMsg: Message = {
      role: "user",
      content: text.trim(),
      timestamp: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
    };
    const thinkingMsg: Message = { role: "ai", content: "", timestamp: "", thinking: true };
    setMessages((prev) => [...prev, userMsg, thinkingMsg]);
    setInput("");
    setLoading(true);

    try {
      await invoke("save_ai_message", { threadId: activeThreadId, role: "user", content: text.trim() });
    } catch {}

    const history = [...messages, userMsg]
      .filter((m) => !m.thinking)
      .slice(-12)
      .map((m) => ({ role: m.role === "user" ? "user" : "ai", content: m.content }));

    try {
      const res = await invoke<string>("jarvis_chat", { message: text.trim(), history });
      const aiMsg: Message = {
        role: "ai",
        content: res,
        timestamp: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
      };
      setMessages((prev) => [...prev.filter((m) => !m.thinking), aiMsg]);
      await invoke("save_ai_message", { threadId: activeThreadId, role: "ai", content: res });
      await loadThreads();
    } catch {
      setMessages((prev) => [...prev.filter((m) => !m.thinking), {
        role: "ai",
        content: "Ollama isn't responding. Make sure it's running with `ollama serve`.",
        timestamp: new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
      }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const quickPrompts = [
    "Summarize my finances",
    "Where am I leaking money?",
    "Am I on track this cycle?",
    "What should I prioritize?",
  ];

  // ---- THREADS VIEW ----
  if (view === "threads") {
    return (
      <div className="p-4 space-y-4">
        <div>
          <p className="text-xs uppercase tracking-wider" style={{color:'var(--muted)'}}>AI Conversations</p>
          <p className="text-xs mt-0.5" style={{color:'var(--muted)'}}>Saved locally • Never leave this device</p>
        </div>

        <div className="rounded-xl p-3 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
          <p className="text-xs mb-2" style={{color:'var(--muted)'}}>Start a new conversation</p>
          <div className="flex gap-2">
            <input
              type="text"
              value={newThreadName}
              onChange={(e) => setNewThreadName(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && createThread()}
              placeholder="Name it (e.g. June analysis)"
              className="flex-1 rounded-lg px-3 py-2 text-sm outline-none"
              style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}}
            />
            <button
              onClick={createThread}
              disabled={creatingThread}
              className="px-4 py-2 rounded-lg text-sm text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50 transition-all"
            >
              {creatingThread ? "..." : "+ New"}
            </button>
          </div>
        </div>

        {threads.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-sm" style={{color:'var(--muted)'}}>No conversations yet.</p>
            <p className="text-xs mt-1" style={{color:'var(--muted)'}}>Start one above.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {threads.map((t) => (
              <div
                key={t.id}
                onClick={() => renamingId !== t.id && openThread(t.id)}
                className="rounded-xl p-3 border cursor-pointer transition-all hover:border-blue-500/40"
                style={{background:'var(--bg2)', borderColor:'var(--border)'}}
              >
                {renamingId === t.id ? (
                  <div className="flex gap-2" onClick={(e) => e.stopPropagation()}>
                    <input
                      autoFocus
                      type="text"
                      value={renameValue}
                      onChange={(e) => setRenameValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") renameThread(t.id);
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      className="flex-1 rounded-lg px-2 py-1 text-sm outline-none"
                      style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}}
                    />
                    <button
                      onClick={() => renameThread(t.id)}
                      className="text-xs px-2 py-1 rounded-lg bg-blue-600 text-white"
                    >
                      ✓
                    </button>
                    <button
                      onClick={() => setRenamingId(null)}
                      className="text-xs px-2"
                      style={{color:'var(--muted)'}}
                    >
                      ✕
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate" style={{color:'var(--text)'}}>{t.name}</p>
                      <p className="text-xs mt-0.5" style={{color:'var(--muted)'}}>
                        Last active {t.last_active.split("T")[0]}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 ml-2">
                      <button
                        onClick={(e) => { e.stopPropagation(); setRenamingId(t.id); setRenameValue(t.name); }}
                        className="text-xs px-2 py-1 rounded-lg transition-all hover:bg-blue-500/20 hover:text-blue-400"
                        style={{color:'var(--muted)'}}
                        title="Rename"
                      >
                        ✎
                      </button>
                      <button
                        onClick={(e) => deleteThread(t.id, e)}
                        className="text-xs px-2 py-1 rounded-lg transition-all hover:bg-red-500/20 hover:text-red-400"
                        style={{color:'var(--muted)'}}
                        title="Delete"
                      >
                        ✕
                      </button>
                      <span className="text-xs ml-1" style={{color:'var(--muted)'}}>→</span>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ---- CHAT VIEW ----
  const activeThread = threads.find((t) => t.id === activeThreadId);

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-2 border-b" style={{borderColor:'var(--border)'}}>
        <button
          onClick={() => setView("threads")}
          className="text-sm transition-all hover:text-blue-400"
          style={{color:'var(--muted)'}}
        >
          ←
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate" style={{color:'var(--text)'}}>{activeThread?.name ?? "Conversation"}</p>
          <p className="text-xs" style={{color:'var(--muted)'}}>Offline • Saved to device</p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <div className="pt-4">
            <p className="text-sm font-medium mb-1" style={{color:'var(--text)'}}>What do you want to know?</p>
            <p className="text-xs mb-4" style={{color:'var(--muted)'}}>I have your full financial data. Ask anything.</p>
            <div className="flex flex-wrap gap-2">
              {quickPrompts.map((q) => (
                <button
                  key={q}
                  onClick={() => send(q)}
                  className="text-xs px-3 py-1.5 rounded-full border transition-all hover:border-blue-500/50 hover:text-blue-300"
                  style={{borderColor:'var(--border)', color:'var(--muted)'}}
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
            {msg.role === "ai" && (
              <div className="max-w-[85%]">
                {msg.thinking ? (
                  <div className="rounded-2xl rounded-tl-sm px-4 py-3 border"
                    style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
                    <div className="flex gap-1 items-center">
                      {[0,150,300].map((d) => (
                        <div key={d} className="w-1.5 h-1.5 rounded-full bg-blue-400 animate-bounce"
                          style={{animationDelay:`${d}ms`}} />
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="rounded-2xl rounded-tl-sm px-4 py-3 border"
                    style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
                    <div className="text-sm leading-relaxed prose prose-invert prose-sm max-w-none"
                      style={{color:'var(--text)'}}>
                      <ReactMarkdown>{msg.content}</ReactMarkdown>
                    </div>
                    {msg.timestamp && (
                      <p className="text-xs mt-1.5" style={{color:'var(--muted)'}}>{msg.timestamp}</p>
                    )}
                  </div>
                )}
              </div>
            )}
            {msg.role === "user" && (
              <div className="max-w-[80%] rounded-2xl rounded-tr-sm px-4 py-2.5 bg-blue-600">
                <p className="text-sm text-white leading-relaxed">{msg.content}</p>
                {msg.timestamp && <p className="text-xs text-blue-200 mt-0.5">{msg.timestamp}</p>}
              </div>
            )}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="px-4 pb-3 pt-2 border-t" style={{borderColor:'var(--border)'}}>
        <div className="flex gap-2 items-end">
          <div className="flex-1 rounded-2xl border px-4 py-2.5 transition-colors"
            style={{background:'var(--bg2)', borderColor: input ? '#3b82f6' : 'var(--border)'}}>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(input); }}}
              placeholder={loading ? "Thinking..." : "Ask anything..."}
              className="w-full bg-transparent text-sm outline-none"
              style={{color:'var(--text)'}}
              disabled={loading}
            />
          </div>
          <button
            onClick={() => send(input)}
            disabled={loading || !input.trim()}
            className="w-10 h-10 rounded-2xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 flex items-center justify-center transition-all flex-shrink-0"
          >
            <span className="text-white text-sm">↑</span>
          </button>
        </div>
        <p className="text-xs mt-1.5 px-1" style={{color:'var(--muted)'}}>
          Enter to send • Saved to device • Persists forever
        </p>
      </div>
    </div>
  );
}

// ============================================================
// BOTTOM NAV
// ============================================================
function BottomNav({ screen, setScreen }: { screen: Screen; setScreen: (s: Screen) => void }) {
  const items: { id: Screen; label: string; icon: string }[] = [
  { id: "dashboard", label: "Home", icon: "⊞" },
  { id: "add", label: "Log", icon: "+" },
  { id: "transactions", label: "History", icon: "≡" },
  { id: "ai", label: "AI", icon: "◈" },
  { id: "settings", label: "More", icon: "⚙" },
  ];

  return (
    <div className="h-16 bg-zinc-900 border-t border-zinc-800 flex items-center">
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => setScreen(item.id)}
          className={`flex-1 flex flex-col items-center justify-center gap-0.5 transition-all ${
            screen === item.id ? "text-blue-400" : "text-zinc-600 hover:text-zinc-400"
          }`}
        >
          <span className="text-lg">{item.icon}</span>
          <span className="text-xs">{item.label}</span>
        </button>
      ))}
    </div>
  );
}

// ============================================================
// VAULT GATE — passphrase unlock / first-launch vault creation
// ============================================================
type VaultState = "loading" | "create" | "recovery-shown" | "unlock" | "error";

function VaultGate({ onUnlocked }: { onUnlocked: () => void }) {
  const [state, setState] = useState<VaultState>("loading");
  const [passphrase, setPassphrase] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [recoveryKey, setRecoveryKey] = useState("");
  const [savedConfirmed, setSavedConfirmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassphrase, setShowPassphrase] = useState(false);
  const [showRecoveryInput, setShowRecoveryInput] = useState(false);
  const [recoveryInput, setRecoveryInput] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const exists = await invoke<boolean>("vault_status");
        setState(exists ? "unlock" : "create");
      } catch {
        setError("Could not reach the vault. Try restarting Cistern.");
      }
    })();
  }, []);

  const handleCreate = async () => {
    setError(null);
    if (passphrase.length < 10) {
      setError("Your password should be at least 10 characters.");
      return;
    }
    if (passphrase !== confirmPassphrase) {
      setError("The two passwords don't match.");
      return;
    }
    setBusy(true);
    try {
      const key = await invoke<string>("create_vault_cmd", { passphrase });
      setRecoveryKey(key);
      setState("recovery-shown");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleUnlock = async () => {
    setError(null);
    setBusy(true);
    try {
      await invoke("unlock_vault_cmd", { passphrase });
      onUnlocked();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleRecoveryUnlock = async () => {
    setError(null);
    setBusy(true);
    try {
      await invoke("unlock_vault_with_recovery_cmd", { recoveryKey: recoveryInput });
      onUnlocked();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const gateStyle = {
    background: "#0b0a08",
    color: "#e8dcc4",
  };

  if (state === "loading") {
    return (
      <div className="flex items-center justify-center h-screen" style={gateStyle}>
        <p className="text-sm" style={{ color: "#8a8270" }}>Opening your vault...</p>
      </div>
    );
  }

  if (state === "recovery-shown") {
    return (
      <div className="flex items-center justify-center h-screen p-6" style={gateStyle}>
        <div className="max-w-md w-full rounded-xl p-8" style={{ background: "#0b0a08", border: "0.5px solid #3a3226" }}>
          <h1 className="text-center mb-1" style={{ fontSize: 22, color: "#FAC775", fontFamily: "Georgia, 'Times New Roman', serif" }}>Save your recovery key</h1>
          <p className="text-xs text-center mb-6" style={{ color: "#8a8270" }}>
            This is the only way back in if you forget your password. It will not be shown again.
          </p>
          <div
            className="rounded-lg p-4 mb-4 text-center font-mono tracking-wider"
            style={{ background: "#17140f", border: "0.5px solid #3a3226", color: "#e8dcc4", fontSize: 15 }}
          >
            {recoveryKey}
          </div>
          <button
            onClick={() => navigator.clipboard.writeText(recoveryKey)}
            className="w-full h-9 rounded-lg text-xs mb-4"
            style={{ background: "#17140f", border: "0.5px solid #3a3226", color: "#c9bda0" }}
          >
            Copy to clipboard
          </button>
          <label className="flex items-start gap-2 mb-4 text-xs" style={{ color: "#8a8270" }}>
            <input
              type="checkbox"
              checked={savedConfirmed}
              onChange={(e) => setSavedConfirmed(e.target.checked)}
              className="mt-0.5"
            />
            I have saved this somewhere safe, not on this device.
          </label>
          <button
            disabled={!savedConfirmed}
            onClick={onUnlocked}
            className="w-full h-10 rounded-lg text-sm font-medium disabled:opacity-40"
            style={{ background: "#3C3489", color: "#EEEDFE" }}
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center h-screen p-6" style={gateStyle}>
      <div className="w-full rounded-xl"  style={{ background: "#0b0a08", border: "0.5px solid #3a3226", maxWidth: 420, padding: "2.5rem 2rem" }}>
        <div className="text-center mb-6">
          <div style={{ fontSize: 28, color: "#BA7517", marginBottom: 8 }}>🔒</div>
          <p style={{ fontSize: 26, color: "#FAC775", letterSpacing: 0.5, fontFamily: "Georgia, 'Times New Roman', serif" }}>Cistern</p>
          <p className="text-xs mt-1" style={{ color: "#8a8270" }}>
            {state === "create" ? "Set up your vault" : "Your vault is sealed. Enter your password."}
          </p>
        </div>

        {state === "create" && !showRecoveryInput && (
          <>
            <label className="block text-xs mb-1" style={{ color: "#8a8270" }}>Enter your password</label>
            <div className="relative mb-3">
              <input
                type={showPassphrase ? "text" : "password"}
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                className="w-full h-10 rounded-lg px-3 pr-10 text-sm outline-none"
                style={{ background: "#17140f", border: "0.5px solid #3a3226", color: "#e8dcc4" }}
              />
              <button type="button" onClick={() => setShowPassphrase(!showPassphrase)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: "#8a8270" }}>
                {showPassphrase ? "🙈" : "👁"}
              </button>
            </div>
            <label className="block text-xs mb-1" style={{ color: "#8a8270" }}>Confirm your password</label>
            <div className="relative mb-4">
              <input
                type={showPassphrase ? "text" : "password"}
                value={confirmPassphrase}
                onChange={(e) => setConfirmPassphrase(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreate()}
                className="w-full h-10 rounded-lg px-3 pr-10 text-sm outline-none"
                style={{ background: "#17140f", border: "0.5px solid #3a3226", color: "#e8dcc4" }}
              />
              <button type="button" onClick={() => setShowPassphrase(!showPassphrase)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs" style={{ color: "#8a8270" }}>
                {showPassphrase ? "🙈" : "👁"}
              </button>
            </div>
            <button
              onClick={handleCreate}
              disabled={busy}
              className="w-full h-10 rounded-lg text-sm font-medium disabled:opacity-50"
              style={{ background: "#3C3489", color: "#EEEDFE" }}
            >
              {busy ? "Sealing the vault..." : "Create the Vault"}
            </button>
          </>
        )}

        {state === "unlock" && !showRecoveryInput && (
          <>
            <label className="block text-xs mb-1" style={{ color: "#8a8270" }}>Enter your password</label>
            <div className="relative mb-3">
              <input
                type={showPassphrase ? "text" : "password"}
                value={passphrase}
                onChange={(e) => setPassphrase(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
                className="w-full h-10 rounded-lg px-3 pr-10 text-sm outline-none"
                style={{ background: "#17140f", border: "0.5px solid #3a3226", color: "#e8dcc4" }}
              />
              <button
                type="button"
                onClick={() => setShowPassphrase(!showPassphrase)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs"
                style={{ color: "#8a8270" }}
              >
                {showPassphrase ? "🙈" : "👁"}
              </button>
            </div>
            <button
              onClick={handleUnlock}
              disabled={busy}
              className="w-full h-10 rounded-lg text-sm font-medium disabled:opacity-50 mb-3"
              style={{ background: "#3C3489", color: "#EEEDFE" }}
            >
              {busy ? "Unlocking..." : "Enter the Vault"}
            </button>
            <button
              onClick={() => setShowRecoveryInput(true)}
              className="w-full text-center text-xs"
              style={{ color: "#7f9977" }}
            >
              Forgot your password?
            </button>
          </>
        )}

        {showRecoveryInput && (
          <>
            <label className="block text-xs mb-1" style={{ color: "#8a8270" }}>Your recovery key</label>
            <input
              type="text"
              value={recoveryInput}
              onChange={(e) => setRecoveryInput(e.target.value.toUpperCase())}
              onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
              placeholder="XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX-XXXX"
              className="w-full h-10 rounded-lg px-3 mb-4 text-sm outline-none font-mono"
              style={{ background: "#17140f", border: "0.5px solid #3a3226", color: "#e8dcc4" }}
            />
            <button
              onClick={handleRecoveryUnlock}
              disabled={busy}
              className="w-full h-10 rounded-lg text-sm font-medium disabled:opacity-50 mb-3"
              style={{ background: "#3C3489", color: "#EEEDFE" }}
            >
              {busy ? "Unlocking..." : "Unlock with recovery key"}
            </button>
            <button
              onClick={() => setShowRecoveryInput(false)}
              className="w-full text-center text-xs"
              style={{ color: "#7f9977" }}
            >
              Back to password
            </button>
          </>
        )}

        {error && (
          <p className="text-xs mt-3 text-center" style={{ color: "#D85A30" }}>{error}</p>
        )}
      </div>
    </div>
  );
}
// ============================================================
// PLANNING ENVIRONMENT — forward cash-flow simulator
// ============================================================
function PlanningEnvironment() {
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"list" | "create" | "view" | "compare" | "calendar" | "templates">("list");
  const [activeSessionId, setActiveSessionId] = useState<number | null>(null);
  const [compareIds, setCompareIds] = useState<[number | null, number | null]>([null, null]);
  const [projection, setProjection] = useState<any>(null);
  const [comparison, setComparison] = useState<any>(null);

  const [newName, setNewName] = useState("");
  const [newLocked, setNewLocked] = useState("");

  const [itemType, setItemType] = useState<"income" | "expense">("expense");
  const [itemLabel, setItemLabel] = useState("");
  const [itemAmount, setItemAmount] = useState("");
  const [itemDate, setItemDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [itemEfPct, setItemEfPct] = useState("");
  const [itemPriority, setItemPriority] = useState("1");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [templates, setTemplates] = useState<any[]>([]);
  const [calendar, setCalendar] = useState<any[]>([]);

  const loadSessions = async () => {
    try { setSessions(await invoke<any[]>("get_planning_sessions")); }
    finally { setLoading(false); }
  };

  useEffect(() => { loadSessions(); }, []);

  const createSession = async () => {
    if (!newName) { setMsg("Name required."); return; }
    setSaving(true);
    try {
      const id = await invoke<number>("create_planning_session", { name: newName, lockedAmount: newLocked ? parseFloat(newLocked) : 0 });
      setNewName(""); setNewLocked("");
      await loadSessions();
      openSession(id);
    } catch (e) { setMsg("Error: " + e); }
    finally { setSaving(false); }
  };

  const openSession = async (id: number) => {
    setActiveSessionId(id);
    setMode("view");
    const p = await invoke<any>("get_session_projection_with_stress", { sessionId: id });
    setProjection(p);
  };

  const addItem = async () => {
    if (!activeSessionId || !itemLabel || !itemAmount) { setMsg("Label and amount required."); return; }
    setSaving(true);
    try {
      await invoke("add_planned_item", {
        sessionId: activeSessionId,
        itemType,
        label: itemLabel,
        amount: parseFloat(itemAmount),
        plannedDate: itemDate,
        emergencyFundPct: itemType === "income" && itemEfPct ? parseFloat(itemEfPct) : null,
        linkedTargetId: null,
        priority: parseInt(itemPriority) || 1,
      });
      setItemLabel(""); setItemAmount(""); setItemEfPct("");
      const p = await invoke<any>("get_session_projection", { sessionId: activeSessionId });
      setProjection(p);
    } catch (e) { setMsg("Error: " + e); }
    finally { setSaving(false); }
  };

  const removeItem = async (id: number) => {
    if (!activeSessionId) return;
    await invoke("delete_planned_item", { id });
    const p = await invoke<any>("get_session_projection", { sessionId: activeSessionId });
    setProjection(p);
  };

  const removeSession = async (id: number) => {
    await invoke("delete_planning_session", { id });
    await loadSessions();
    setMode("list");
  };

  const duplicateAsVariant = async () => {
    if (!activeSessionId) return;
    const name = prompt("Name for this variant?");
    if (!name) return;
    const newId = await invoke<number>("duplicate_session_as_variant", { sessionId: activeSessionId, newName: name });
    await loadSessions();
    openSession(newId);
  };

  const runCompare = async () => {
    if (!compareIds[0] || !compareIds[1]) return;
    const c = await invoke<any>("compare_sessions", { sessionIdA: compareIds[0], sessionIdB: compareIds[1] });
    setComparison(c);
  };

  const materialize = async (itemId: number) => {
    const category = prompt("Category for this transaction?", "Other");
    if (!category) return;
    try {
      await invoke("materialize_planned_item", {
        itemId, bucketId: null, sourceId: null, category, necessityTier: "comfort",
      });
      if (activeSessionId) {
        const p = await invoke<any>("get_session_projection", { sessionId: activeSessionId });
        setProjection(p);
      }
      setMsg("✓ Logged as a real transaction.");
    } catch (e) { setMsg("Error: " + e); }
  };

  if (loading) return <div className="p-4 text-sm" style={{color:'var(--muted)'}}>Loading...</div>;

  // ---------- LIST MODE ----------
  if (mode === "list") {
    return (
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-wider" style={{color:'var(--muted)'}}>Planning environment</p>
            <p className="text-xs mt-0.5" style={{color:'var(--muted)'}}>Lock funds, plan forward, compare timing</p>
          </div>
          <button onClick={() => setMode("create")}
            className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-all">
            + New session
          </button>
        </div>

        {sessions.length >= 2 && (
          <button onClick={() => setMode("compare")}
            className="w-full py-2 rounded-lg text-xs border transition-all"
            style={{borderColor:'var(--border)', color:'var(--muted)'}}>
            Compare two sessions
          </button>
        )}

        <div className="flex gap-2">
          <button onClick={async () => { setCalendar(await invoke("get_planning_calendar")); setMode("calendar"); }}
            className="flex-1 py-2 rounded-lg text-xs border" style={{borderColor:'var(--border)', color:'var(--muted)'}}>
            Cross-session timeline
          </button>
          <button onClick={async () => { setTemplates(await invoke("get_session_templates")); setMode("templates"); }}
            className="flex-1 py-2 rounded-lg text-xs border" style={{borderColor:'var(--border)', color:'var(--muted)'}}>
            Templates
          </button>
        </div>

        {sessions.length === 0 ? (
          <div className="text-center py-10 rounded-xl border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
            <p className="text-sm" style={{color:'var(--muted)'}}>No planning sessions yet.</p>
          </div>
        ) : (
          <div className="space-y-2">
            {sessions.map((s) => (
              <div key={s.id} onClick={() => openSession(s.id)}
                className="rounded-xl p-3 border cursor-pointer transition-all hover:border-blue-500/40"
                style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
                <div className="flex justify-between items-center">
                  <p className="text-sm font-medium" style={{color:'var(--text)'}}>{s.name}</p>
                  <p className="text-xs" style={{color:'var(--muted)'}}>Locked: {fmt(s.locked_amount)}</p>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // ---------- CREATE MODE ----------
  if (mode === "create") {
    return (
      <div className="p-4 space-y-4">
        <p className="text-xs uppercase tracking-wider" style={{color:'var(--muted)'}}>New planning session</p>
        <div className="rounded-xl p-3 border space-y-3" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
          <div>
            <label className="text-xs block mb-1" style={{color:'var(--muted)'}}>Session name</label>
            <input type="text" value={newName} onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Course + eye drops, Aug"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}} />
          </div>
          <div>
            <label className="text-xs block mb-1" style={{color:'var(--muted)'}}>Amount to lock away (₹)</label>
            <input type="number" value={newLocked} onChange={(e) => setNewLocked(e.target.value)}
              placeholder="e.g. 10000"
              className="w-full rounded-lg px-3 py-2 text-sm outline-none"
              style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}} />
            <p className="text-xs mt-1" style={{color:'var(--muted)'}}>
              You'll plan from your current balance minus this locked amount.
            </p>
          </div>
          {msg && <p className="text-xs text-red-400">{msg}</p>}
          <div className="flex gap-2">
            <button onClick={() => setMode("list")} className="flex-1 py-2 rounded-lg text-sm" style={{background:'var(--bg3)', color:'var(--muted)'}}>Cancel</button>
            <button onClick={createSession} disabled={saving} className="flex-1 py-2 rounded-lg text-sm text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50">
              {saving ? "Creating..." : "Create session"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---------- COMPARE MODE ----------
  if (mode === "compare") {
    return (
      <div className="p-4 space-y-4">
        <p className="text-xs uppercase tracking-wider" style={{color:'var(--muted)'}}>Compare sessions</p>
        <div className="flex gap-2">
          <select value={compareIds[0] || ""} onChange={(e) => setCompareIds([parseInt(e.target.value), compareIds[1]])}
            className="flex-1 rounded-lg px-2 py-2 text-sm outline-none" style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}}>
            <option value="">Session A...</option>
            {sessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select value={compareIds[1] || ""} onChange={(e) => setCompareIds([compareIds[0], parseInt(e.target.value)])}
            className="flex-1 rounded-lg px-2 py-2 text-sm outline-none" style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}}>
            <option value="">Session B...</option>
            {sessions.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <button onClick={runCompare} disabled={!compareIds[0] || !compareIds[1]}
          className="w-full py-2 rounded-lg text-sm text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50">
          Compare
        </button>

        {comparison && (
          <div className="grid grid-cols-2 gap-3">
            {[comparison.a, comparison.b].map((p: any, idx: number) => (
              <div key={idx} className="rounded-xl p-3 border" style={{background:'var(--bg2)', borderColor: p.breach_count > 0 ? 'rgba(239,68,68,0.4)' : 'var(--border)'}}>
                <p className="text-sm font-medium mb-2" style={{color:'var(--text)'}}>{p.session_name}</p>
                <p className="text-xs" style={{color:'var(--muted)'}}>Final balance</p>
                <p className={`text-lg font-semibold ${p.final_balance >= 0 ? "text-green-400" : "text-red-400"}`}>{fmt(p.final_balance)}</p>
                <p className="text-xs mt-2" style={{color:'var(--muted)'}}>Lowest point</p>
                <p className={`text-sm ${p.min_balance >= 0 ? "text-blue-400" : "text-red-400"}`}>{fmt(p.min_balance)}</p>
                {p.breach_count > 0 && (
                  <p className="text-xs mt-2 text-red-400">⚠ Goes negative {p.breach_count}x</p>
                )}
              </div>
            ))}
          </div>
        )}

        <button onClick={() => setMode("list")} className="w-full py-2 rounded-lg text-xs" style={{background:'var(--bg2)', color:'var(--muted)'}}>Back</button>
      </div>
    );
  }

  if (mode === "calendar") {
    return (
      <div className="p-4 space-y-3">
        <p className="text-xs uppercase tracking-wider" style={{color:'var(--muted)'}}>Cross-session timeline</p>
        {calendar.map((c, i) => (
          <div key={i} className="rounded-lg p-2 border flex justify-between" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
            <div>
              <p className="text-sm" style={{color:'var(--text)'}}>{c.label}</p>
              <p className="text-xs" style={{color:'var(--muted)'}}>{c.date} · {c.session}</p>
            </div>
            <p className={`text-sm ${c.type === "income" ? "text-green-400" : "text-red-400"}`}>{fmt(c.amount)}</p>
          </div>
        ))}
        <button onClick={() => setMode("list")} className="w-full py-2 rounded-lg text-xs" style={{background:'var(--bg2)', color:'var(--muted)'}}>Back</button>
      </div>
    );
  }

  if (mode === "templates") {
    return (
      <div className="p-4 space-y-3">
        <p className="text-xs uppercase tracking-wider" style={{color:'var(--muted)'}}>Session templates</p>
        {templates.length === 0 && <p className="text-xs" style={{color:'var(--muted)'}}>No templates yet — save one from a session's detail view.</p>}
        {templates.map((t) => (
          <div key={t.id} className="rounded-lg p-2 border flex justify-between items-center" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
            <p className="text-sm" style={{color:'var(--text)'}}>{t.name.replace("[Template] ", "")}</p>
            <button onClick={async () => {
              const name = prompt("New session name?"); if (!name) return;
              const locked = prompt("Lock away amount? (0 if none)", "0");
              const id = await invoke<number>("create_session_from_template", { templateId: t.id, newName: name, lockedAmount: parseFloat(locked || "0") });
              await loadSessions(); openSession(id);
            }} className="text-xs text-blue-400">Use template</button>
          </div>
        ))}
        <button onClick={() => setMode("list")} className="w-full py-2 rounded-lg text-xs" style={{background:'var(--bg2)', color:'var(--muted)'}}>Back</button>
      </div>
    );
  }

  // ---------- VIEW MODE (session detail + timeline) ----------
  if (mode === "view" && projection) {
    return (
      <div className="p-4 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium" style={{color:'var(--text)'}}>{projection.session_name}</p>
            <p className="text-xs" style={{color:'var(--muted)'}}>Locked {fmt(projection.locked_amount)} · Starting from {fmt(projection.starting_balance)}</p>
          </div>
          <button onClick={() => setMode("list")} className="text-xs" style={{color:'var(--muted)'}}>← Back</button>
        </div>

        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-lg p-2" style={{background:'var(--bg2)'}}>
            <p className="text-xs" style={{color:'var(--muted)'}}>Final balance</p>
            <p className={`text-sm font-semibold ${projection.final_balance >= 0 ? "text-green-400" : "text-red-400"}`}>{fmt(projection.final_balance)}</p>
          </div>
          <div className="rounded-lg p-2" style={{background:'var(--bg2)'}}>
            <p className="text-xs" style={{color:'var(--muted)'}}>Lowest point</p>
            <p className={`text-sm font-semibold ${projection.min_balance >= 0 ? "text-blue-400" : "text-red-400"}`}>{fmt(projection.min_balance)}</p>
          </div>
          <div className="rounded-lg p-2" style={{background:'var(--bg2)'}}>
            <p className="text-xs" style={{color:'var(--muted)'}}>To emergency fund</p>
            <p className="text-sm font-semibold text-blue-400">{fmt(projection.total_emergency_skimmed)}</p>
          </div>
        </div>

        {projection.breach_count > 0 && (
          <div className="rounded-xl p-3 border border-red-500/30" style={{background:'rgba(239,68,68,0.05)'}}>
            <p className="text-xs text-red-400 mb-1">⚠ This plan goes negative {projection.breach_count} time(s)</p>
            {projection.suggested_cuts?.length > 0 && (
              <>
                <p className="text-xs mb-1" style={{color:'var(--muted)'}}>Suggested cuts to stay afloat:</p>
                {projection.suggested_cuts.map((c: any) => (
                  <p key={c.id} className="text-xs" style={{color:'var(--muted)'}}>• {c.label} ({fmt(c.amount)})</p>
                ))}
              </>
            )}
          </div>
        )}

        {projection.stressed_income?.length > 0 && (
          <div className="rounded-xl p-3 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
            <p className="text-xs uppercase tracking-wider mb-2" style={{color:'var(--muted)'}}>Stress test — if income underperforms</p>
            {projection.stressed_income.map((s: any) => (
              <p key={s.item_id} className="text-xs" style={{color:'var(--muted)'}}>
                {s.label}: reliability {(s.reliability_score * 100).toFixed(0)}% → expect {fmt(s.stressed_estimate)} instead of {fmt(s.expected)}
              </p>
            ))}
          </div>
        )}
        {projection.opportunity_cost_illustrative > 0 && (
          <div className="rounded-xl p-3 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
            <p className="text-xs" style={{color:'var(--muted)'}}>Opportunity cost of locked funds (illustrative)</p>
            <p className="text-sm text-yellow-400">{fmt(projection.opportunity_cost_illustrative)}</p>
            <p className="text-xs mt-1" style={{color:'var(--muted)'}}>{projection.opportunity_cost_note}</p>
          </div>
        )}

        {/* Add item form */}
        <div className="rounded-xl p-3 border space-y-2" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
          <div className="flex gap-2">
            <button onClick={() => setItemType("expense")} className={`flex-1 py-1.5 rounded-lg text-xs ${itemType === "expense" ? "bg-red-500/20 text-red-300" : "text-zinc-500"}`}>Expense</button>
            <button onClick={() => setItemType("income")} className={`flex-1 py-1.5 rounded-lg text-xs ${itemType === "income" ? "bg-green-500/20 text-green-300" : "text-zinc-500"}`}>Income</button>
          </div>
          <input type="text" value={itemLabel} onChange={(e) => setItemLabel(e.target.value)} placeholder="Label (e.g. Course fee)"
            className="w-full rounded-lg px-2 py-1.5 text-sm outline-none" style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}} />
          <div className="flex gap-2">
            <input type="number" value={itemAmount} onChange={(e) => setItemAmount(e.target.value)} placeholder="Amount"
              className="flex-1 rounded-lg px-2 py-1.5 text-sm outline-none" style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}} />
            <input type="date" value={itemDate} onChange={(e) => setItemDate(e.target.value)}
              className="flex-1 rounded-lg px-2 py-1.5 text-sm outline-none" style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}} />
          </div>
          {itemType === "income" && (
            <input type="number" value={itemEfPct} onChange={(e) => setItemEfPct(e.target.value)} placeholder="Emergency fund % (optional)"
              className="w-full rounded-lg px-2 py-1.5 text-sm outline-none" style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}} />
          )}
          {itemType === "expense" && (
            <div>
              <label className="text-xs block mb-1" style={{color:'var(--muted)'}}>Priority (1=must-have, higher=cut first if tight)</label>
              <input type="number" value={itemPriority} onChange={(e) => setItemPriority(e.target.value)}
                className="w-full rounded-lg px-2 py-1.5 text-sm outline-none" style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}} />
            </div>
          )}
          {msg && <p className={`text-xs ${msg.startsWith("✓") ? "text-green-400" : "text-red-400"}`}>{msg}</p>}
          <button onClick={addItem} disabled={saving} className="w-full py-2 rounded-lg text-sm text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50">
            {saving ? "Adding..." : "Add to plan"}
          </button>
        </div>

        {/* Timeline */}
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wider" style={{color:'var(--muted)'}}>Timeline</p>
          {projection.timeline.map((t: any) => (
            <div key={t.id} className="rounded-xl p-3 border" style={{background:'var(--bg2)', borderColor: t.is_breach ? 'rgba(239,68,68,0.4)' : 'var(--border)'}}>
              <div className="flex justify-between items-start">
                <div>
                  <p className="text-sm" style={{color:'var(--text)'}}>{t.label}</p>
                  <p className="text-xs" style={{color:'var(--muted)'}}>{t.date} · {t.type}{t.emergency_skim > 0 && ` · ${fmt(t.emergency_skim)} to EF`}</p>
                </div>
                <div className="text-right">
                  <p className={`text-sm font-medium ${t.net_effect >= 0 ? "text-green-400" : "text-red-400"}`}>{t.net_effect >= 0 ? "+" : ""}{fmt(t.net_effect)}</p>
                  <p className={`text-xs ${t.running_balance >= 0 ? "text-blue-400" : "text-red-400"}`}>bal: {fmt(t.running_balance)}</p>
                </div>
              </div>
              <div className="flex gap-2 mt-2">
                <button onClick={() => removeItem(t.id)} className="text-xs text-red-400">Remove</button>
                <button onClick={() => materialize(t.id)} className="text-xs text-blue-400">Log as real transaction</button>
              </div>
            </div>
          ))}
        </div>

        <div className="flex gap-2">
          <button onClick={duplicateAsVariant} className="flex-1 py-2 rounded-lg text-xs border" style={{borderColor:'var(--border)', color:'var(--muted)'}}>
            Duplicate as variant
          </button>
          <button onClick={async () => {
            const name = prompt("Template name?"); if (!name || !activeSessionId) return;
            await invoke("save_session_as_template", { sessionId: activeSessionId, templateName: name });
            alert("Saved as template.");
          }} className="flex-1 py-2 rounded-lg text-xs border" style={{borderColor:'var(--border)', color:'var(--muted)'}}>
            Save as template
          </button>
          <button onClick={() => activeSessionId && removeSession(activeSessionId)} className="flex-1 py-2 rounded-lg text-xs border border-red-500/30 text-red-400">
            Delete session
          </button>
        </div>
      </div>
    );
  }

  return null;
}
// ============================================================
// SEALED RESERVE — real frozen funds, released only on purpose
// ============================================================
function SealedReserve({ onSuccess }: { onSuccess: () => void }) {
  const [reserves, setReserves] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [amount, setAmount] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");
  const [unsealing, setUnsealing] = useState<number | null>(null);
  const [unsealPass, setUnsealPass] = useState("");

  const load = async () => {
    try { setReserves(await invoke<any[]>("get_sealed_reserves")); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const seal = async () => {
    if (!label || !amount) { setMsg("Label and amount required."); return; }
    setSaving(true);
    try {
      await invoke("seal_reserve", { label, amount: parseFloat(amount) });
      setLabel(""); setAmount("");
      setMsg("✓ Sealed.");
      await load();
      onSuccess();
      setTimeout(() => setMsg(""), 2000);
    } catch (e) { setMsg("Error: " + e); }
    finally { setSaving(false); }
  };

  const unseal = async (id: number) => {
    if (!unsealPass) return;
    setSaving(true);
    try {
      await invoke("unseal_reserve", { id, passphrase: unsealPass });
      setUnsealing(null);
      setUnsealPass("");
      await load();
    } catch (e) { setMsg("Error: " + e); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="p-4 text-sm" style={{color:'var(--muted)'}}>Loading...</div>;

  const active = reserves.filter((r) => !r.is_released);
  const released = reserves.filter((r) => r.is_released);
  const totalSealed = active.reduce((sum, r) => sum + r.amount, 0);

  return (
    <div className="p-4 space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wider" style={{color:'var(--muted)'}}>Sealed reserve</p>
        <p className="text-xs mt-0.5" style={{color:'var(--muted)'}}>
          Real money, frozen out of your operating balance. Unsealing requires your password — a conscious decision, not a toggle.
        </p>
      </div>

      <div className="rounded-xl p-4 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
        <p className="text-xs" style={{color:'var(--muted)'}}>Currently sealed</p>
        <p className="text-2xl font-semibold" style={{color:'var(--text)'}}>{fmt(totalSealed)}</p>
      </div>

      <div className="rounded-xl p-3 border space-y-2" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
        <p className="text-xs font-medium" style={{color:'var(--text)'}}>Seal a new amount</p>
        <input type="text" value={label} onChange={(e) => setLabel(e.target.value)}
          placeholder="Label (e.g. Hostel deposit, Semester fee buffer)"
          className="w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}} />
        <input type="number" value={amount} onChange={(e) => setAmount(e.target.value)}
          placeholder="Amount (₹)"
          className="w-full rounded-lg px-3 py-2 text-sm outline-none"
          style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}} />
        {msg && <p className={`text-xs ${msg.startsWith("✓") ? "text-green-400" : "text-red-400"}`}>{msg}</p>}
        <button onClick={seal} disabled={saving} className="w-full py-2 rounded-lg text-sm text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50">
          {saving ? "Sealing..." : "Seal this amount"}
        </button>
      </div>

      {active.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wider" style={{color:'var(--muted)'}}>Active seals</p>
          {active.map((r) => (
            <div key={r.id} className="rounded-xl p-3 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
              <div className="flex justify-between items-start mb-2">
                <div>
                  <p className="text-sm font-medium" style={{color:'var(--text)'}}>{r.label}</p>
                  <p className="text-xs" style={{color:'var(--muted)'}}>Sealed {r.sealed_at.slice(0,10)}</p>
                </div>
                <p className="text-sm font-semibold" style={{color:'var(--text)'}}>{fmt(r.amount)}</p>
              </div>
              {unsealing === r.id ? (
                <div className="space-y-2">
                  <input type="password" value={unsealPass} onChange={(e) => setUnsealPass(e.target.value)}
                    placeholder="Confirm your password to unseal"
                    className="w-full rounded-lg px-2 py-1.5 text-sm outline-none"
                    style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}} />
                  <div className="flex gap-2">
                    <button onClick={() => { setUnsealing(null); setUnsealPass(""); }} className="flex-1 py-1.5 rounded-lg text-xs" style={{background:'var(--bg3)', color:'var(--muted)'}}>Cancel</button>
                    <button onClick={() => unseal(r.id)} disabled={saving} className="flex-1 py-1.5 rounded-lg text-xs text-white bg-red-600 hover:bg-red-500 disabled:opacity-50">Confirm unseal</button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setUnsealing(r.id)} className="w-full py-1.5 rounded-lg text-xs border" style={{borderColor:'var(--border)', color:'var(--muted)'}}>
                  Unseal
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {released.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wider" style={{color:'var(--muted)'}}>Released history</p>
          {released.map((r) => (
            <div key={r.id} className="rounded-xl p-3 border opacity-60" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
              <div className="flex justify-between items-center">
                <p className="text-sm" style={{color:'var(--text)'}}>{r.label}</p>
                <p className="text-sm" style={{color:'var(--muted)'}}>{fmt(r.amount)}</p>
              </div>
              <p className="text-xs" style={{color:'var(--muted)'}}>Released {r.released_at?.slice(0,10)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ============================================================
// EMERGENCY FUND — separate, protected, friction-gated
// ============================================================
function EmergencyFund() {
  const [balance, setBalance] = useState(0);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"list" | "spend" | "borrow">("list");

  const [spendAmount, setSpendAmount] = useState("");
  const [spendCategory, setSpendCategory] = useState("");
  const [spendDesc, setSpendDesc] = useState("");
  const [spendDate, setSpendDate] = useState(() => new Date().toISOString().split("T")[0]);
  const [spendPass, setSpendPass] = useState("");

  const [borrowAmount, setBorrowAmount] = useState("");
  const [borrowDate, setBorrowDate] = useState(() => new Date().toISOString().split("T")[0]);

  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const load = async () => {
    try {
      const [b, t] = await Promise.all([
        invoke<number>("get_emergency_fund_balance"),
        invoke<any[]>("get_emergency_transactions"),
      ]);
      setBalance(b);
      setTransactions(t);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const spend = async () => {
    if (!spendAmount || !spendCategory || !spendPass) { setMsg("Amount, category, and passphrase required."); return; }
    setSaving(true);
    try {
      await invoke("add_emergency_expense", {
        amount: parseFloat(spendAmount), category: spendCategory,
        description: spendDesc || null, date: spendDate, passphrase: spendPass,
      });
      setSpendAmount(""); setSpendCategory(""); setSpendDesc(""); setSpendPass("");
      setMode("list");
      await load();
      setMsg("✓ Logged.");
      setTimeout(() => setMsg(""), 2000);
    } catch (e) { setMsg("Error: " + e); }
    finally { setSaving(false); }
  };

  const borrow = async () => {
    if (!borrowAmount) { setMsg("Amount required."); return; }
    setSaving(true);
    try {
      await invoke("borrow_from_regular_to_emergency", { amount: parseFloat(borrowAmount), date: borrowDate });
      setBorrowAmount("");
      setMode("list");
      await load();
      setMsg("✓ Transferred.");
      setTimeout(() => setMsg(""), 2000);
    } catch (e) { setMsg("Error: " + e); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="p-4 text-sm" style={{color:'var(--muted)'}}>Loading...</div>;

  return (
    <div className="p-4 space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wider" style={{color:'var(--muted)'}}>Emergency fund</p>
        <p className="text-xs mt-0.5" style={{color:'var(--muted)'}}>
          Entirely separate from your regular balance and History. Spending here requires your password.
        </p>
      </div>

      <div className="rounded-xl p-4 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
        <p className="text-xs" style={{color:'var(--muted)'}}>Emergency fund balance</p>
        <p className="text-2xl font-semibold text-blue-400">{fmt(balance)}</p>
      </div>

      {mode === "list" && (
        <div className="flex gap-2">
          <button onClick={() => setMode("spend")} className="flex-1 py-2 rounded-lg text-sm text-white bg-red-600 hover:bg-red-500">
            Spend from fund
          </button>
          <button onClick={() => setMode("borrow")} className="flex-1 py-2 rounded-lg text-sm border" style={{borderColor:'var(--border)', color:'var(--muted)'}}>
            Borrow from surplus
          </button>
        </div>
      )}

      {mode === "spend" && (
        <div className="rounded-xl p-3 border space-y-2" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
          <p className="text-xs font-medium" style={{color:'var(--text)'}}>Spend from Emergency Fund</p>
          <input type="number" value={spendAmount} onChange={(e) => setSpendAmount(e.target.value)} placeholder="Amount (₹)"
            className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}} />
          <input type="text" value={spendCategory} onChange={(e) => setSpendCategory(e.target.value)} placeholder="Category"
            className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}} />
          <input type="text" value={spendDesc} onChange={(e) => setSpendDesc(e.target.value)} placeholder="Note (optional)"
            className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}} />
          <input type="date" value={spendDate} onChange={(e) => setSpendDate(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}} />
          <input type="password" value={spendPass} onChange={(e) => setSpendPass(e.target.value)} placeholder="Confirm your password"
            className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}} />
          {msg && <p className={`text-xs ${msg.startsWith("✓") ? "text-green-400" : "text-red-400"}`}>{msg}</p>}
          <div className="flex gap-2">
            <button onClick={() => setMode("list")} className="flex-1 py-2 rounded-lg text-sm" style={{background:'var(--bg3)', color:'var(--muted)'}}>Cancel</button>
            <button onClick={spend} disabled={saving} className="flex-1 py-2 rounded-lg text-sm text-white bg-red-600 hover:bg-red-500 disabled:opacity-50">
              {saving ? "Logging..." : "Confirm spend"}
            </button>
          </div>
        </div>
      )}

      {mode === "borrow" && (
        <div className="rounded-xl p-3 border space-y-2" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
          <p className="text-xs font-medium" style={{color:'var(--text)'}}>Borrow from regular surplus</p>
          <p className="text-xs" style={{color:'var(--muted)'}}>
            Only genuinely free surplus (not sealed, not already committed) can be transferred in.
          </p>
          <input type="number" value={borrowAmount} onChange={(e) => setBorrowAmount(e.target.value)} placeholder="Amount (₹)"
            className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}} />
          <input type="date" value={borrowDate} onChange={(e) => setBorrowDate(e.target.value)}
            className="w-full rounded-lg px-3 py-2 text-sm outline-none" style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}} />
          {msg && <p className={`text-xs ${msg.startsWith("✓") ? "text-green-400" : "text-red-400"}`}>{msg}</p>}
          <div className="flex gap-2">
            <button onClick={() => setMode("list")} className="flex-1 py-2 rounded-lg text-sm" style={{background:'var(--bg3)', color:'var(--muted)'}}>Cancel</button>
            <button onClick={borrow} disabled={saving} className="flex-1 py-2 rounded-lg text-sm text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50">
              {saving ? "Transferring..." : "Confirm transfer"}
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        <p className="text-xs uppercase tracking-wider" style={{color:'var(--muted)'}}>Emergency fund history</p>
        {transactions.length === 0 ? (
          <p className="text-xs text-center py-6" style={{color:'var(--muted)'}}>Nothing logged here yet.</p>
        ) : transactions.map((t) => (
          <div key={t.id} className="rounded-xl p-3 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
            <div className="flex justify-between items-center">
              <div>
                <p className="text-sm" style={{color:'var(--text)'}}>{t.category}</p>
                <p className="text-xs" style={{color:'var(--muted)'}}>{t.date}{t.description && ` · ${t.description}`}</p>
              </div>
              <p className={`text-sm font-medium ${t.type === "income" ? "text-green-400" : "text-red-400"}`}>
                {t.type === "income" ? "+" : "-"}{fmt(t.amount)}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
// ============================================================
// LOAN / DEBT MODEL — deterministic feasibility, auto-repayment
// ============================================================
function LoanDebtModel() {
  const [activeLoans, setActiveLoans] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [mode, setMode] = useState<"list" | "apply">("list");

  const [principal, setPrincipal] = useState("");
  const [repayment, setRepayment] = useState("");
  const [label, setLabel] = useState("");
  const [feasibility, setFeasibility] = useState<any>(null);
  const [checking, setChecking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState("");

  const [repayingId, setRepayingId] = useState<number | null>(null);
  const [repayAmount, setRepayAmount] = useState("");

  const load = async () => {
    try {
      const [a, h] = await Promise.all([
        invoke<any[]>("get_active_loans"),
        invoke<any[]>("get_loan_history"),
      ]);
      setActiveLoans(a);
      setHistory(h);
    } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const runCheck = async () => {
    if (!principal || !repayment) { setMsg("Principal and repayment per cycle required."); return; }
    setChecking(true);
    try {
      const f = await invoke<any>("check_loan_feasibility", {
        principal: parseFloat(principal), repaymentPerCycle: parseFloat(repayment),
      });
      setFeasibility(f);
    } catch (e) { setMsg("Error: " + e); }
    finally { setChecking(false); }
  };

  const confirmTake = async () => {
    if (!label || !principal || !repayment) { setMsg("Label, principal, and repayment required."); return; }
    setSaving(true);
    try {
      await invoke("take_loan", { label, principal: parseFloat(principal), repaymentPerCycle: parseFloat(repayment) });
      setLabel(""); setPrincipal(""); setRepayment(""); setFeasibility(null);
      setMode("list");
      await load();
      setMsg("✓ Loan taken and credited.");
      setTimeout(() => setMsg(""), 2500);
    } catch (e) { setMsg("Error: " + e); }
    finally { setSaving(false); }
  };

  const repay = async (id: number) => {
    if (!repayAmount) return;
    setSaving(true);
    try {
      await invoke("repay_loan_manual", { loanId: id, amount: parseFloat(repayAmount) });
      setRepayingId(null);
      setRepayAmount("");
      await load();
    } catch (e) { setMsg("Error: " + e); }
    finally { setSaving(false); }
  };

  if (loading) return <div className="p-4 text-sm" style={{color:'var(--muted)'}}>Loading...</div>;

  if (mode === "apply") {
    return (
      <div className="p-4 space-y-4">
        <p className="text-xs uppercase tracking-wider" style={{color:'var(--muted)'}}>Apply for a loan against future income</p>

        <div className="rounded-xl p-3 border space-y-2" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
          <input type="text" value={label} onChange={(e) => setLabel(e.target.value)}
            placeholder="What's this loan for?"
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}} />
          <input type="number" value={principal} onChange={(e) => { setPrincipal(e.target.value); setFeasibility(null); }}
            placeholder="Amount you need now (₹)"
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}} />
          <input type="number" value={repayment} onChange={(e) => { setRepayment(e.target.value); setFeasibility(null); }}
            placeholder="Repayment per cycle (₹) — auto-skimmed from future income"
            className="w-full rounded-lg px-3 py-2 text-sm outline-none"
            style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}} />
          {msg && <p className={`text-xs ${msg.startsWith("✓") ? "text-green-400" : "text-red-400"}`}>{msg}</p>}
          <button onClick={runCheck} disabled={checking} className="w-full py-2 rounded-lg text-sm text-white bg-blue-600 hover:bg-blue-500 disabled:opacity-50">
            {checking ? "Checking..." : "Check feasibility"}
          </button>
        </div>

        {feasibility && (
          <div className="rounded-xl p-4 border" style={{background:'var(--bg2)', borderColor: feasibility.feasible ? 'rgba(34,197,94,0.4)' : 'rgba(239,68,68,0.4)'}}>
            <p className={`text-sm font-medium mb-2 ${feasibility.feasible ? "text-green-400" : "text-red-400"}`}>
              {feasibility.feasible ? "✓ This loan looks sustainable" : "⚠ This would strain your finances"}
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs mb-3">
              <div>
                <p style={{color:'var(--muted)'}}>Repayment period</p>
                <p style={{color:'var(--text)'}}>{feasibility.cycles_to_repay} cycle(s)</p>
              </div>
              <div>
                <p style={{color:'var(--muted)'}}>Lowest projected balance</p>
                <p className={feasibility.min_projected_balance >= feasibility.survival_floor ? "text-green-400" : "text-red-400"}>
                  {fmt(feasibility.min_projected_balance)}
                </p>
              </div>
              <div>
                <p style={{color:'var(--muted)'}}>Your typical net per cycle</p>
                <p style={{color:'var(--text)'}}>{fmt(feasibility.net_per_cycle_before_loan)}</p>
              </div>
              <div>
                <p style={{color:'var(--muted)'}}>Survival floor</p>
                <p style={{color:'var(--text)'}}>{fmt(feasibility.survival_floor)}</p>
              </div>
            </div>

            {!feasibility.feasible && (
              <div className="rounded-lg p-2 mb-3" style={{background:'var(--bg3)'}}>
                <p className="text-xs" style={{color:'var(--muted)'}}>
                  At your current pace, this breaches your survival floor by cycle {feasibility.breach_cycle}.
                  Consider {fmt(feasibility.suggested_repayment_per_cycle)}/cycle instead, over ~{Math.ceil(feasibility.suggested_cycles)} cycles.
                </p>
                <button onClick={() => setRepayment(String(Math.round(feasibility.suggested_repayment_per_cycle)))}
                  className="text-xs text-blue-400 mt-1">Use this suggestion</button>
              </div>
            )}

            <button onClick={confirmTake} disabled={saving}
              className={`w-full py-2 rounded-lg text-sm text-white disabled:opacity-50 ${feasibility.feasible ? "bg-green-600 hover:bg-green-500" : "bg-red-600 hover:bg-red-500"}`}>
              {saving ? "Processing..." : feasibility.feasible ? "Take this loan" : "Take anyway (not recommended)"}
            </button>
          </div>
        )}

        <button onClick={() => { setMode("list"); setFeasibility(null); }} className="w-full py-2 rounded-lg text-xs" style={{background:'var(--bg2)', color:'var(--muted)'}}>
          Cancel
        </button>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wider" style={{color:'var(--muted)'}}>Loans</p>
          <p className="text-xs mt-0.5" style={{color:'var(--muted)'}}>Borrow against your own future income — repayment auto-skims from real income going forward</p>
        </div>
        <button onClick={() => setMode("apply")} className="text-xs px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white transition-all">
          + Apply
        </button>
      </div>

      {activeLoans.length === 0 ? (
        <div className="text-center py-8 rounded-xl border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
          <p className="text-sm" style={{color:'var(--muted)'}}>No active loans.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {activeLoans.map((l) => (
            <div key={l.id} className="rounded-xl p-3 border" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
              <div className="flex justify-between items-start mb-2">
                <p className="text-sm font-medium" style={{color:'var(--text)'}}>{l.label}</p>
                <p className="text-sm" style={{color:'var(--text)'}}>{fmt(l.remaining)} left</p>
              </div>
              <div className="w-full rounded-full h-1.5 mb-1" style={{background:'var(--bg3)'}}>
                <div className="h-1.5 rounded-full bg-blue-500" style={{width:`${Math.min(l.pct_repaid,100)}%`}} />
              </div>
              <p className="text-xs mb-2" style={{color:'var(--muted)'}}>
                {fmt(l.total_repaid)} / {fmt(l.principal)} repaid · {fmt(l.repayment_per_cycle)}/cycle auto-skim
              </p>
              {repayingId === l.id ? (
                <div className="flex gap-2">
                  <input type="number" value={repayAmount} onChange={(e) => setRepayAmount(e.target.value)}
                    placeholder="Extra repayment (₹)"
                    className="flex-1 rounded-lg px-2 py-1.5 text-sm outline-none"
                    style={{background:'var(--bg3)', color:'var(--text)', border:'1px solid var(--border)'}} />
                  <button onClick={() => repay(l.id)} disabled={saving} className="px-3 py-1.5 rounded-lg text-xs text-white bg-blue-600 hover:bg-blue-500">Pay</button>
                  <button onClick={() => setRepayingId(null)} className="px-2 py-1.5 text-xs" style={{color:'var(--muted)'}}>✕</button>
                </div>
              ) : (
                <button onClick={() => setRepayingId(l.id)} className="w-full py-1.5 rounded-lg text-xs border" style={{borderColor:'var(--border)', color:'var(--muted)'}}>
                  Make an extra repayment
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {history.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs uppercase tracking-wider" style={{color:'var(--muted)'}}>History</p>
          {history.map((h) => (
            <div key={h.id} className="rounded-xl p-3 border opacity-70" style={{background:'var(--bg2)', borderColor:'var(--border)'}}>
              <div className="flex justify-between">
                <p className="text-sm" style={{color:'var(--text)'}}>{h.label}</p>
                <p className={`text-xs ${h.status === "repaid" ? "text-green-400" : "text-red-400"}`}>{h.status}</p>
              </div>
              <p className="text-xs" style={{color:'var(--muted)'}}>{fmt(h.total_repaid)} / {fmt(h.principal)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
// ============================================================
// ROOT APP
// ============================================================
function App() {
  const [theme, setTheme] = useState<"dark"|"light"|"oled">(() =>
    (localStorage.getItem("cistern-theme") as any) || "dark"
  );
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [unlocked, setUnlocked] = useState(false);
  const [vitals, setVitals] = useState<Vitals | null>(null);
  const [buckets, setBuckets] = useState<BucketHealth[]>([]);

  useEffect(() => {
    localStorage.setItem("cistern-theme", theme);
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const loadData = useCallback(async () => {
    try { setVitals(await invoke<Vitals>("get_vitals")); } catch {}
    try { setBuckets(await invoke<BucketHealth[]>("get_bucket_health")); } catch {}
  }, []);

  useEffect(() => {
    if (unlocked) {
      loadData();
    }
  }, [unlocked, loadData]);

  const bgStyle = { background: "var(--bg)", color: "var(--text)" };

  if (!unlocked) {
    return <VaultGate onUnlocked={() => setUnlocked(true)} />;
  }

  return (
    <div className="flex flex-col h-screen overflow-hidden" style={bgStyle}>
      <VitalsStrip vitals={vitals} />
      <div className="flex-1 overflow-y-auto">
        {screen === "dashboard" && (
          <>
            <NudgeStrip />
            <Dashboard vitals={vitals} buckets={buckets} setScreen={setScreen} />
          </>
        )}
        {screen === "add" && <AddTransaction buckets={buckets} onSuccess={loadData} />}
        {screen === "buckets" && <BucketManager onSuccess={() => { loadData(); setScreen("dashboard"); }} />}
        {screen === "transactions" && <Transactions />}
        {screen === "floor" && <FloorRadar onSetFloor={loadData} />}
        {screen === "cycles" && <CycleManager onCycleChange={loadData} />}
        {screen === "ai" && <AiChat vitals={vitals} />}
        {screen === "settings" && (
          <div className="p-4 space-y-4">
            <p className="text-xs uppercase tracking-wider" style={{color:'var(--muted)'}}>More</p>

            {/* Quick nav to other screens */}
            <div className="grid grid-cols-2 gap-2">
              {([
                { id: "buckets", label: "Buckets", icon: "◫", desc: "Manage money buckets" },
                { id: "floor", label: "Floor radar", icon: "▲", desc: "Financial floor analysis" },
                { id: "networth", label: "Net worth", icon: "∿", desc: "Wealth trajectory curve" },
                { id: "savings", label: "Goals", icon: "◎", desc: "Savings targets" },
                { id: "cycles", label: "Cycles", icon: "↺", desc: "Cycle management" },
                { id: "identity", label: "Identity card", icon: "◉", desc: "Your financial fingerprint" },
                { id: "compare", label: "Compare cycles", icon: "⇄", desc: "Side by side cycle analysis" },
                { id: "export", label: "Export data", icon: "↗", desc: "CSV or JSON export" },
                { id: "backup", label: "Backup", icon: "⊙", desc: "One-click database backup" },
                { id: "scenario", label: "Simulator", icon: "⟳", desc: "What-if scenario modeling" },
                { id: "letter", label: "Weekly letter", icon: "✉", desc: "AI narrative of your finances" },
                { id: "mpc", label: "MPC trend", icon: "⟆", desc: "Spending discipline over time" },
                { id: "habits", label: "Habit tracker", icon: "◐", desc: "Annual cost of recurring spend" },
                { id: "ghosts", label: "Ghost buckets", icon: "◌", desc: "Unbucketed spending detected" },
                { id: "archaeology", label: "Bucket history", icon: "⊕", desc: "Full bucket biography" },
                { id: "memory", label: "Ledger memory", icon: "★", desc: "Financial autobiography" },
                { id: "reliability", label: "Source scores", icon: "◈", desc: "Income reliability analysis" },
                { id: "patterns", label: "My patterns", icon: "⟆", desc: "Behavioral pattern recognition" },
                { id: "planning", label: "Planning", icon: "◧", desc: "Forward cash-flow planning environment" },
                { id: "sealed", label: "Sealed Reserve", icon: "◫", desc: "Frozen funds, released on purpose" },
                { id: "emergency", label: "Emergency Fund", icon: "◆", desc: "Separate, protected reserve" },
                { id: "loans", label: "Loans", icon: "◒", desc: "Borrow against your own future income" },
              ] as { id: Screen; label: string; icon: string; desc: string }[]).map((item) => (
                <button
                  key={item.id}
                  onClick={() => setScreen(item.id)}
                  className="rounded-xl p-3 border text-left transition-all hover:border-blue-500/40"
                  style={{background:'var(--bg2)', borderColor:'var(--border)'}}
                >
                  <p className="text-lg mb-1">{item.icon}</p>
                  <p className="text-sm font-medium" style={{color:'var(--text)'}}>{item.label}</p>
                  <p className="text-xs" style={{color:'var(--muted)'}}>{item.desc}</p>
                </button>
              ))}
            </div>

            <div className="divider" style={{height:'0.5px', background:'var(--border)'}} />
            <p className="text-xs" style={{color:'var(--muted)'}}>Theme</p>
            <ThemeToggle theme={theme} setTheme={setTheme} />
          </div>
        )}
        {screen === "networth" && <NetWorthCurve />}
        {screen === "savings" && <SavingsTargets onSuccess={loadData} />}
        {screen === "identity" && <FinancialIdentityCard />}
        {screen === "compare" && <PeriodComparison />}
        {screen === "export" && <ExportData />}
        {screen === "backup" && <BackupRestore />}
        {screen === "scenario" && <ScenarioSimulator />}
        {screen === "letter" && <WeeklyLetter />}
        {screen === "mpc" && <MpcTrend />}
        {screen === "habits" && <HabitCompound />}
        {screen === "ghosts" && <GhostBuckets setScreen={setScreen} />}
        {screen === "archaeology" && <BucketArchaeology />}
        {screen === "memory" && <LedgerMemory />}
        {screen === "reliability" && <SourceReliability />}
        {screen === "patterns" && <BehavioralPatterns />}
        {screen === "planning" && <PlanningEnvironment />}
        {screen === "sealed" && <SealedReserve onSuccess={loadData} />}
        {screen === "emergency" && <EmergencyFund />}
        {screen === "loans" && <LoanDebtModel />}
      </div>
      <BottomNav screen={screen} setScreen={setScreen} />
    </div>
  );
}

export default App;
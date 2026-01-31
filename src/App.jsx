import React, { useEffect, useMemo, useState } from "react";
import "./App.css";

// =====================
// Storage keys
// =====================
const STORAGE_TAKEN = "suppPlanner:taken:v3";
const STORAGE_PRICES = "suppPlanner:prices:v1";

// =====================
// Robust JSON parse (FIX: handles null/"null"/non-objects)
// =====================
function safeJsonObject(s, fallback = {}) {
  if (s === null || s === undefined || s === "") return fallback;
  try {
    const v = JSON.parse(s);
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
    return fallback; // handles null, numbers, strings, arrays
  } catch {
    return fallback;
  }
}

// =====================
// Date utils
// =====================
function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseISODate(s) {
  if (!s) return null;
  if (s instanceof Date && !Number.isNaN(s.getTime())) return s;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function startOfWeekMonday(d) {
  const wd = d.getDay(); // Sun=0
  const delta = wd === 0 ? -6 : 1 - wd;
  const x = new Date(d);
  x.setDate(x.getDate() + delta);
  x.setHours(0, 0, 0, 0);
  return x;
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

// =====================
// Canonical key (fix UC-II mismatch etc.)
// =====================
function canonKey(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[®™©]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// =====================
// Weekday detection in text (fix Copper etc.)
// =====================
function isoWeekday(d) {
  const js = d.getDay(); // 0=Dom..6=Sáb
  return js === 0 ? 7 : js; // 1=Lun..7=Dom
}

function normText(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

function extractWeekdaysFromText(...parts) {
  const t = normText(parts.filter(Boolean).join(" "));
  const map = [
    { keys: ["lun", "lunes"], val: 1 },
    { keys: ["mar", "martes"], val: 2 },
    { keys: ["mie", "miercoles", "miércoles"], val: 3 },
    { keys: ["jue", "jueves"], val: 4 },
    { keys: ["vie", "viernes"], val: 5 },
    { keys: ["sab", "sabado", "sábado", "sabados", "sábados"], val: 6 },
    { keys: ["dom", "domingo"], val: 7 },
  ];

  const set = new Set();
  for (const { keys, val } of map) {
    for (const k of keys) {
      const re = new RegExp(`\\b${k}\\b`, "i");
      if (re.test(t)) set.add(val);
    }
  }

  // Compact patterns like "mar/jue/sab"
  if (t.includes("/")) {
    const chunks = t.split(/[^a-z]+/).filter(Boolean);
    const chunkSet = new Set(chunks);
    for (const { keys, val } of map) {
      for (const k of keys) {
        if (chunkSet.has(k)) set.add(val);
      }
    }
  }

  return set.size ? set : null;
}

// =====================
// Dose parsing for cost estimation
// =====================
function parseNumberLoose(text) {
  const t = normText(text).replace(",", ".");
  if (t.includes("½")) return 0.5;

  const frac = t.match(/(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)/);
  if (frac) {
    const a = Number(frac[1]);
    const b = Number(frac[2]);
    if (Number.isFinite(a) && Number.isFinite(b) && b !== 0) return a / b;
  }

  const range = t.match(/(\d+(?:\.\d+)?)\s*-\s*(\d+(?:\.\d+)?)/);
  if (range) {
    const a = Number(range[1]);
    const b = Number(range[2]);
    if (Number.isFinite(a) && Number.isFinite(b)) return (a + b) / 2;
  }

  const m = t.match(/(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isFinite(v) ? v : null;
}

function parseDoseUnits(doseText, preferredUnit /* "caps"|"g"|"" */) {
  const t = normText(doseText);

  const hasCaps = /caps|capsula|c[aá]psula|tablet|tab|softgel/.test(t);
  const hasGrams = (/\bgr\b|\bgrs\b|\bg\b|\bgramo/.test(t) && !/\bmg\b/.test(t));
  const hasMg = /\bmg\b/.test(t);

  const num = parseNumberLoose(t);

  if (preferredUnit === "caps") {
    if (num !== null) return { value: num, unit: "caps" };
    if (hasCaps) return { value: 1, unit: "caps" };
    return null;
  }
  if (preferredUnit === "g") {
    if (hasGrams && num !== null) return { value: num, unit: "g" };
    if (hasMg && num !== null) return { value: num / 1000, unit: "g" };
    if (num !== null && !hasCaps) return { value: num, unit: "g" };
    return null;
  }

  if (hasCaps) return { value: num !== null ? num : 1, unit: "caps" };
  if (hasGrams) return { value: num !== null ? num : null, unit: "g" };
  if (hasMg) return { value: num !== null ? num / 1000 : null, unit: "g" };

  return null;
}

// =====================
// UI helpers
// =====================
function Progress({ ratio }) {
  const pct = clamp(Math.round((ratio || 0) * 100), 0, 100);
  return (
    <div className="progress">
      <div className="progressFill" style={{ width: `${pct}%` }} />
      <div className="progressText">{pct}%</div>
    </div>
  );
}

function Pill({ children, tone = "neutral" }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

function money(v) {
  if (!Number.isFinite(v)) return "—";
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "EUR" }).format(v);
}

function number(v, digits = 2) {
  if (!Number.isFinite(v)) return "—";
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(v);
}

// =====================
// Error boundary (no more "blank screen")
// =====================
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }
  static getDerivedStateFromError(error) {
    return { err: error };
  }
  componentDidCatch(error, info) {
    // You can also log to console
    // eslint-disable-next-line no-console
    console.error("App crashed:", error, info);
  }
  render() {
    if (this.state.err) {
      return (
        <div className="card cardError" style={{ marginTop: 12 }}>
          <div className="cardTitle">La app ha fallado (ErrorBoundary)</div>
          <div className="muted">Copia el error de consola si necesitas ayuda adicional.</div>
          <pre className="pre">{String(this.state.err?.message || this.state.err)}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

// =====================
// Main export wrapper
// =====================
export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}

// =====================
// App logic (inner)
// =====================
function AppInner() {
  const [fileName, setFileName] = useState("");
  const [params, setParams] = useState([]);
  const [routine, setRoutine] = useState([]);
  const [selectedDate, setSelectedDate] = useState(() => toISODate(new Date()));
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(new Date()));
  const [yearCursor, setYearCursor] = useState(() => new Date().getFullYear());
  const [view, setView] = useState("day");
  const [showOff, setShowOff] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");

  // FIX: safeJsonObject avoids null state that crashes rendering
  const [taken, setTaken] = useState(() => safeJsonObject(localStorage.getItem(STORAGE_TAKEN), {}));
  useEffect(() => localStorage.setItem(STORAGE_TAKEN, JSON.stringify(taken || {})), [taken]);

  const [prices, setPrices] = useState(() => safeJsonObject(localStorage.getItem(STORAGE_PRICES), {}));
  useEffect(() => localStorage.setItem(STORAGE_PRICES, JSON.stringify(prices || {})), [prices]);

  const paramByCanon = useMemo(() => {
    const m = new Map();
    for (const p of params) m.set(p.canon, p);
    return m;
  }, [params]);

  const allSupp = useMemo(() => {
    const map = new Map();
    for (const r of routine) map.set(r.canon, r.suplemento);
    for (const p of params) if (!map.has(p.canon)) map.set(p.canon, p.name);
    return Array.from(map.entries())
      .map(([canon, name]) => ({ canon, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [routine, params]);

  function computeStatusForDate(dateObj, p) {
    if (!p?.startDate || !Number.isFinite(p.onDays) || !Number.isFinite(p.offDays)) return "ON";
    const dayIndex = Math.floor((dateObj.getTime() - p.startDate.getTime()) / 86400000);
    if (dayIndex < 0) return "OFF";
    if (dayIndex < (p.pauseDays || 0)) return "OFF";
    const effective = dayIndex - (p.pauseDays || 0);
    const period = p.onDays + p.offDays;
    if (period <= 0) return "ON";
    const pos = ((effective % period) + period) % period;
    return pos < p.onDays ? "ON" : "OFF";
  }

  // Fix #1 weekday + Fix #2 canonical matching + showOff for OFF items
  function isPlannedForDate(dateObj, routineItem) {
    const wdSet = extractWeekdaysFromText(routineItem.dosis, routineItem.regla, routineItem.notas);
    if (wdSet && !wdSet.has(isoWeekday(dateObj))) return false;

    const p = paramByCanon.get(routineItem.canon);
    if (!p) return true;

    const st = computeStatusForDate(dateObj, p);
    return st === "ON" ? true : showOff;
  }

  function plannedItemsForISO(dateISO) {
    const d = parseISODate(dateISO);
    if (!d) return [];
    return routine
      .filter((ri) => isPlannedForDate(d, ri))
      .map((ri) => {
        const p = paramByCanon.get(ri.canon);
        const st = p ? computeStatusForDate(d, p) : "ON";
        return { ...ri, status: st };
      })
      .sort((a, b) => (a._ord - b._ord) || a.suplemento.localeCompare(b.suplemento));
  }

  function getTakenMap(dateISO) {
    const base = taken && typeof taken === "object" ? taken : {};
    return base[dateISO] || {};
  }

  function setTakenFor(dateISO, itemKey, value) {
    setTaken((prev) => {
      const p = (prev && typeof prev === "object") ? prev : {};
      const day = { ...(p[dateISO] || {}) };
      if (value) day[itemKey] = true;
      else delete day[itemKey];
      return { ...p, [dateISO]: day };
    });
  }

  function markAll(dateISO) {
    const items = plannedItemsForISO(dateISO).filter((x) => x.status === "ON");
    setTaken((prev) => {
      const p = (prev && typeof prev === "object") ? prev : {};
      const day = { ...(p[dateISO] || {}) };
      for (const it of items) day[it.key] = true;
      return { ...p, [dateISO]: day };
    });
  }

  function clearDay(dateISO) {
    setTaken((prev) => {
      const p = (prev && typeof prev === "object") ? prev : {};
      return { ...p, [dateISO]: {} };
    });
  }

  const dayObj = useMemo(() => parseISODate(selectedDate) || new Date(), [selectedDate]);
  const todayISO = toISODate(new Date());

  function completionForDate(dateObj) {
    const iso = toISODate(dateObj);
    const planned = plannedItemsForISO(iso).filter((x) => x.status === "ON");
    const tm = getTakenMap(iso);
    const plannedCount = planned.length;
    const takenCount = planned.filter((x) => tm[x.key]).length;
    return { plannedCount, takenCount, ratio: plannedCount ? takenCount / plannedCount : 0 };
  }

  const weekDays = useMemo(() => {
    const start = startOfWeekMonday(dayObj);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [dayObj]);

  const monthGrid = useMemo(() => {
    const first = startOfMonth(monthCursor);
    const last = endOfMonth(monthCursor);
    const pad = ((first.getDay() + 6) % 7);
    const cells = [];
    for (let i = 0; i < pad; i++) cells.push(null);
    for (let d = 1; d <= last.getDate(); d++) cells.push(new Date(first.getFullYear(), first.getMonth(), d));
    while (cells.length % 7 !== 0) cells.push(null);
    while (cells.length < 42) cells.push(null);
    return cells.slice(0, 42);
  }, [monthCursor]);

  const plannedToday = useMemo(() => plannedItemsForISO(selectedDate), [selectedDate, routine, params, showOff]);
  const takenToday = useMemo(() => getTakenMap(selectedDate), [taken, selectedDate]);

  const groupedByMomento = useMemo(() => {
    const g = new Map();
    for (const it of plannedToday) {
      if (!g.has(it.momento)) g.set(it.momento, []);
      g.get(it.momento).push(it);
    }
    return Array.from(g.entries());
  }, [plannedToday]);

  async function handleUpload(file) {
    setErrorMsg("");
    if (!file) return;
    setFileName(file.name);

    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });

      const sheetNames = wb.SheetNames || [];
      const findSheet = (cands) => {
        const lower = sheetNames.map((s) => s.toLowerCase());
        for (const c of cands) {
          const idx = lower.indexOf(c.toLowerCase());
          if (idx >= 0) return sheetNames[idx];
        }
        for (const c of cands) {
          const idx = lower.findIndex((s) => s.includes(c.toLowerCase()));
          if (idx >= 0) return sheetNames[idx];
        }
        return null;
      };

      const parametrosName = findSheet(["Parametros"]);
      const rutinaName = findSheet(["Rutina_Diaria", "Rutina", "Plan", "Suplementos", "Input"]) || sheetNames[0];

      const toJson = (name) => {
        const ws = wb.Sheets[name];
        return ws ? XLSX.utils.sheet_to_json(ws, { defval: "" }) : [];
      };

      const parametrosRows = parametrosName ? toJson(parametrosName) : [];
      const rutinaRows = rutinaName ? toJson(rutinaName) : [];

      const normalizedParams = parametrosRows
        .map((r) => {
          const name = String(r["Suplemento"] || r["SUPLEMENTO"] || r["Supplement"] || "").trim();
          if (!name) return null;

          const onDays = Number(r["ON (días)"] || r["ON"] || r["ON (dias)"] || r["ON dias"]);
          const offDays = Number(r["OFF (días)"] || r["OFF"] || r["OFF (dias)"] || r["OFF dias"]);
          if (!Number.isFinite(onDays) || !Number.isFinite(offDays)) return null;

          const pauseDays = Number(r["Pausa inicial (días)"] || r["Pausa inicial"] || 0);

          const startRaw = r["Inicio ciclo (fecha)"] || r["Inicio ciclo"] || r["Inicio"];
          let startDate = null;
          if (startRaw instanceof Date && !Number.isNaN(startRaw.getTime())) startDate = startRaw;
          else {
            const d = new Date(String(startRaw || "").trim());
            if (!Number.isNaN(d.getTime())) startDate = d;
          }

          return {
            canon: canonKey(name),
            name,
            startDate,
            onDays: clamp(onDays, 1, 3650),
            offDays: clamp(offDays, 0, 3650),
            pauseDays: clamp(Number.isFinite(pauseDays) ? pauseDays : 0, 0, 3650),
          };
        })
        .filter(Boolean);

      const order = {
        Ayunas: 1,
        "A primera hora antes entreno": 1,
        "POST ENTRENAMIENTO": 2,
        "Post Entrenamiento": 2,
        "ANTES DE DESAYUNO (30 MIN)": 3,
        Desayuno: 4,
        "ANTES DE COMER (30 MIN)": 5,
        Comida: 6,
        Cena: 7,
        "Antes de dormir": 8,
        Noche: 8,
      };

      const normalizedRoutine = rutinaRows
        .map((row) => {
          const momento = String(
            row["Momento"] ||
              row["Momento del Día"] ||
              row["Momento del Dia"] ||
              row["Momento del día"] ||
              ""
          ).trim();

          const suplemento = String(row["Suplemento"] || row["Suplementos"] || row["Supplement"] || "").trim();
          if (!suplemento) return null;

          const dosis = String(row["Dosis"] || row["Dose"] || "").trim();
          const regla = String(row["Regla"] || row["Rule"] || "").trim();
          const notas = String(row["Notas"] || row["Notes"] || "").trim();

          const momentoNorm = momento || "Sin momento";
          return {
            key: `${momentoNorm}||${suplemento}`,
            canon: canonKey(suplemento),
            momento: momentoNorm,
            suplemento,
            dosis,
            regla,
            notas,
            _ord: order[momentoNorm] ?? 99,
          };
        })
        .filter(Boolean);

      setParams(normalizedParams);
      setRoutine(normalizedRoutine);

      setYearCursor(new Date().getFullYear());
      setSelectedDate(todayISO);
      setMonthCursor(startOfMonth(new Date()));
    } catch (e) {
      setErrorMsg(String(e?.message || e));
    }
  }

  // ===== Pricing =====
  function updatePriceField(canon, patch) {
    setPrices((prev) => {
      const p = (prev && typeof prev === "object") ? prev : {};
      return {
        ...p,
        [canon]: { ...(p[canon] || {}), ...patch },
      };
    });
  }

  function plannedItemsForDayDateObj(dateObj) {
    const iso = toISODate(dateObj);
    return plannedItemsForISO(iso).filter((x) => x.status === "ON");
  }

  function computeYearUsage(year) {
    const totals = new Map();
    const start = new Date(year, 0, 1);
    const end = new Date(year, 11, 31);

    for (let d = new Date(start); d <= end; d = addDays(d, 1)) {
      const items = plannedItemsForDayDateObj(d);
      for (const it of items) {
        const pref = prices[it.canon]?.unitType || "";
        const parsed = parseDoseUnits(it.dosis, pref);
        const current = totals.get(it.canon) || { name: it.suplemento, unit: parsed?.unit || pref || "caps", unitsYear: 0 };
        if (parsed?.value) current.unitsYear += parsed.value;
        totals.set(it.canon, current);
      }
    }

    // override u/día (solo días ON)
    const onDaysByCanon = new Map();
    for (let d = new Date(year, 0, 1); d <= new Date(year, 11, 31); d = addDays(d, 1)) {
      const items = plannedItemsForDayDateObj(d);
      const seen = new Set(items.map((x) => x.canon));
      for (const c of seen) onDaysByCanon.set(c, (onDaysByCanon.get(c) || 0) + 1);
    }

    for (const [canon, entry] of totals.entries()) {
      const overrideRaw = prices[canon]?.dailyOverride;
      const overrideVal = overrideRaw !== "" && overrideRaw !== undefined ? Number(String(overrideRaw).replace(",", ".")) : NaN;
      if (Number.isFinite(overrideVal)) {
        const onDays = onDaysByCanon.get(canon) || 0;
        entry.unitsYear = overrideVal * onDays;
      }
    }

    const daysInYear = (new Date(year, 11, 31) - new Date(year, 0, 1)) / 86400000 + 1;
    return { totals, daysInYear };
  }

  const yearCostModel = useMemo(() => {
    if (!routine.length) return null;
    const { totals, daysInYear } = computeYearUsage(yearCursor);

    const rows = [];
    let totalYear = 0;

    for (const s of allSupp) {
      const t = totals.get(s.canon);
      const p = prices[s.canon] || {};

      const priceEUR = Number(String(p.priceEUR || "").replace(",", "."));
      const packSize = Number(String(p.packSize || "").replace(",", "."));
      const unitType = p.unitType || (t?.unit || "caps");
      const unitsYear = t?.unitsYear ?? 0;

      let costYear = NaN;
      if (Number.isFinite(priceEUR) && Number.isFinite(packSize) && packSize > 0) {
        costYear = (unitsYear / packSize) * priceEUR;
      }
      if (Number.isFinite(costYear)) totalYear += costYear;

      rows.push({
        canon: s.canon,
        name: s.name,
        unitType,
        unitsYear,
        priceEUR,
        packSize,
        costYear,
        costMonthAvg: Number.isFinite(costYear) ? costYear / 12 : NaN,
        costDayAvg: Number.isFinite(costYear) ? costYear / daysInYear : NaN,
        missing: !(Number.isFinite(priceEUR) && Number.isFinite(packSize) && packSize > 0),
      });
    }

    rows.sort((a, b) => {
      if (a.missing && !b.missing) return 1;
      if (!a.missing && b.missing) return -1;
      const av = Number.isFinite(a.costYear) ? a.costYear : -1;
      const bv = Number.isFinite(b.costYear) ? b.costYear : -1;
      return bv - av;
    });

    return { rows, totalYear, daysInYear };
  }, [yearCursor, routine, params, prices, allSupp]);

  const navItems = [
    { k: "day", label: "Día" },
    { k: "week", label: "Semana" },
    { k: "month", label: "Mes" },
    { k: "costs", label: "Costes" },
  ];

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-left">
          <div className="app-title">Suplementos Planner</div>
          <div className="app-subtitle">Checklist + calendario + ciclos + costes.</div>
        </div>

        <div className="topbar-right">
          <label className="btn">
            <input type="file" accept=".xlsx,.xls" style={{ display: "none" }} onChange={(e) => handleUpload(e.target.files?.[0])} />
            Subir Excel
          </label>
          <div className="fileName" title={fileName}>{fileName || ""}</div>
        </div>
      </header>

      <div className="toolbar">
        <div className="tabs">
          {navItems.map((x) => (
            <button key={x.k} className={view === x.k ? "tab tabOn" : "tab"} onClick={() => setView(x.k)}>
              {x.label}
            </button>
          ))}
        </div>

        <label className="toggle">
          <input type="checkbox" checked={showOff} onChange={(e) => setShowOff(e.target.checked)} />
          <span>Mostrar OFF</span>
        </label>
      </div>

      {errorMsg ? (
        <div className="card cardError">
          <div className="cardTitle">Error al leer el Excel</div>
          <pre className="pre">{errorMsg}</pre>
        </div>
      ) : null}

      {!routine.length ? (
        <div className="card">
          <div className="cardTitle">Sube tu Excel</div>
          <div className="muted">Recomendado: hojas Parametros y Rutina_Diaria.</div>
        </div>
      ) : null}

      {view === "day" && routine.length ? (
        <div className="card">
          <div className="row">
            <div>
              <div className="cardTitle">Checklist del día</div>
              <div className="muted">{selectedDate}</div>
            </div>
            <input className="date" type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
          </div>

          {(() => {
            const c = completionForDate(dayObj);
            return (
              <div className="row">
                <div className="muted">
                  Completado: <b>{c.takenCount}</b> / <b>{c.plannedCount}</b>
                </div>
                <div className="progressWrap">
                  <Progress ratio={c.ratio} />
                </div>
              </div>
            );
          })()}

          <div className="row">
            <button className="btnPrimary" onClick={() => markAll(selectedDate)}>Marcar todo (ON)</button>
            <button className="btnGhost" onClick={() => clearDay(selectedDate)}>Limpiar</button>
            <button className="btnGhost" onClick={() => setSelectedDate(todayISO)}>Ir a hoy</button>
          </div>

          <div className="sections">
            {groupedByMomento.map(([momento, items]) => (
              <div key={momento} className="section">
                <div className="sectionHead">
                  <div className="sectionTitle">{momento}</div>
                </div>

                <div className="items">
                  {items.map((it) => {
                    const isOff = it.status !== "ON";
                    return (
                      <label key={it.key} className={isOff ? "item itemOff" : "item"}>
                        <input
                          type="checkbox"
                          disabled={isOff}
                          checked={!!takenToday[it.key]}
                          onChange={(e) => setTakenFor(selectedDate, it.key, e.target.checked)}
                        />
                        <div className="itemBody">
                          <div className="itemTop">
                            <div className="itemName">{it.suplemento}</div>
                            <div className="itemBadges">
                              {it.dosis ? <Pill>{it.dosis}</Pill> : null}
                              {isOff ? <Pill tone="off">OFF</Pill> : <Pill tone="on">ON</Pill>}
                            </div>
                          </div>
                          {it.regla ? <div className="muted">{it.regla}</div> : null}
                          {it.notas ? <div className="note">{it.notas}</div> : null}
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {view === "week" && routine.length ? (
        <div className="card">
          <div className="row">
            <div className="cardTitle">Vista semanal</div>
            <input className="date" type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
          </div>

          <div className="cards">
            {weekDays.map((d) => {
              const iso = toISODate(d);
              const c = completionForDate(d);
              return (
                <button key={iso} className="dayCard" onClick={() => { setSelectedDate(iso); setView("day"); }}>
                  <div className="dayCardTop">
                    <div className="dayCardTitle">{d.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short" })}</div>
                    {iso === todayISO ? <Pill>HOY</Pill> : null}
                  </div>
                  <div className="muted">{c.takenCount}/{c.plannedCount}</div>
                  <Progress ratio={c.ratio} />
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {view === "month" && routine.length ? (
        <div className="card">
          <div className="row">
            <div className="cardTitle">Vista mensual</div>
            <div className="row">
              <button className="btnGhost" onClick={() => setMonthCursor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}>←</button>
              <div className="muted">{monthCursor.toLocaleString(undefined, { month: "long", year: "numeric" })}</div>
              <button className="btnGhost" onClick={() => setMonthCursor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}>→</button>
            </div>
          </div>

          <div className="monthHeader">
            {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((x) => <div key={x} className="monthHeadCell">{x}</div>)}
          </div>

          <div className="monthGrid">
            {monthGrid.map((d, idx) => {
              if (!d) return <div key={idx} className="monthCell empty" />;
              const iso = toISODate(d);
              const c = completionForDate(d);
              return (
                <button key={iso} className="monthCell" onClick={() => { setSelectedDate(iso); setView("day"); }}>
                  <div className="monthCellTop">
                    <div className="dayNum">{d.getDate()}</div>
                    {iso === todayISO ? <Pill>HOY</Pill> : null}
                  </div>
                  <div className="muted small">{c.takenCount}/{c.plannedCount}</div>
                  <div className="muted small">{Math.round(c.ratio * 100)}%</div>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {view === "costs" && routine.length ? (
        <div className="card">
          <div className="row">
            <div>
              <div className="cardTitle">Costes por suplemento</div>
              <div className="muted">Introduce precio y tamaño envase. Se calcula coste anual/mensual/diario.</div>
            </div>
            <div className="row">
              <button className="btnGhost" onClick={() => setYearCursor((y) => y - 1)}>←</button>
              <div className="yearBox">{yearCursor}</div>
              <button className="btnGhost" onClick={() => setYearCursor((y) => y + 1)}>→</button>
            </div>
          </div>

          {yearCostModel ? (
            <>
              <div className="totalsBar">
                <div className="totalsItem">
                  <div className="muted">Total anual</div>
                  <div className="totalsValue">{money(yearCostModel.totalYear)}</div>
                </div>
                <div className="totalsItem">
                  <div className="muted">Mensual (promedio)</div>
                  <div className="totalsValue">{money(yearCostModel.totalYear / 12)}</div>
                </div>
                <div className="totalsItem">
                  <div className="muted">Diario (promedio)</div>
                  <div className="totalsValue">{money(yearCostModel.totalYear / yearCostModel.daysInYear)}</div>
                </div>
              </div>

              <div className="tableWrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Suplemento</th>
                      <th className="num">Precio (€)</th>
                      <th className="num">Tamaño envase</th>
                      <th>Unidad</th>
                      <th className="num">Override u/día</th>
                      <th className="num">Unidades/año</th>
                      <th className="num">€/día</th>
                      <th className="num">€/mes</th>
                      <th className="num">€/año</th>
                    </tr>
                  </thead>
                  <tbody>
                    {yearCostModel.rows.map((r) => {
                      const entry = prices[r.canon] || {};
                      return (
                        <tr key={r.canon} className={r.missing ? "rowMissing" : ""}>
                          <td className="nameCell">
                            <div className="nameMain">{r.name}</div>
                            {r.missing ? <div className="muted small">Faltan datos</div> : null}
                          </td>

                          <td className="num">
                            <input className="inp" inputMode="decimal" value={entry.priceEUR ?? ""} onChange={(e) => updatePriceField(r.canon, { priceEUR: e.target.value })} placeholder="€" />
                          </td>

                          <td className="num">
                            <input className="inp" inputMode="decimal" value={entry.packSize ?? ""} onChange={(e) => updatePriceField(r.canon, { packSize: e.target.value })} placeholder={entry.unitType === "g" ? "g" : "caps"} />
                          </td>

                          <td>
                            <select className="sel" value={entry.unitType || "caps"} onChange={(e) => updatePriceField(r.canon, { unitType: e.target.value })}>
                              <option value="caps">caps</option>
                              <option value="g">g</option>
                            </select>
                          </td>

                          <td className="num">
                            <input className="inp" inputMode="decimal" value={entry.dailyOverride ?? ""} onChange={(e) => updatePriceField(r.canon, { dailyOverride: e.target.value })} placeholder="(opc.)" />
                          </td>

                          <td className="num">{number(r.unitsYear, 2)} {entry.unitType || r.unitType}</td>
                          <td className="num">{money(r.costDayAvg)}</td>
                          <td className="num">{money(r.costMonthAvg)}</td>
                          <td className="num">{money(r.costYear)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="muted small">
                OFF no consume. Rango “4-5 g” se promedia. Si no se interpreta bien, usa override.
              </div>
            </>
          ) : null}
        </div>
      ) : null}

      <nav className="bottomNav">
        {navItems.map((x) => (
          <button key={x.k} className={view === x.k ? "bottomBtn bottomOn" : "bottomBtn"} onClick={() => setView(x.k)}>
            {x.label}
          </button>
        ))}
      </nav>
    </div>
  );
}

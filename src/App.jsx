import React, { useEffect, useMemo, useState } from "react";
import "./App.css";
import * as U from "./util.js";
import { suggestCycleByName } from "./cycleCatalog.js";

// ---- Storage keys (bump version if you change shapes) ----
const STORAGE_ROUTINES = "suppPlanner:routines:v2";
const STORAGE_NOT_TAKEN = "suppPlanner:notTaken:v2";
const STORAGE_CYCLES = "suppPlanner:cycles:v3";
const STORAGE_USER_ROUTINE = "suppPlanner:userRoutine:v2";
const STORAGE_MEALS_BY_DATE = "suppPlanner:mealsByDate:v2";
const STORAGE_PRICES = "suppPlanner:prices:v1";

function Pill({ children, tone = "neutral" }) {
  return <span className={`pill pill-${tone}`}>{children}</span>;
}

function Progress({ ratio }) {
  const pct = U.clamp(Math.round((ratio || 0) * 100), 0, 100);
  return (
    <div className="progress">
      <div className="progressFill" style={{ width: `${pct}%` }} />
      <div className="progressText">{pct}%</div>
    </div>
  );
}

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { err: null };
  }
  static getDerivedStateFromError(error) {
    return { err: error };
  }
  componentDidCatch(error, info) {
    console.error("App crashed:", error, info);
  }
  render() {
    if (this.state.err) {
      return (
        <div className="card cardError" style={{ marginTop: 12 }}>
          <div className="cardTitle">La app ha fallado</div>
          <pre className="pre">{String(this.state.err?.message || this.state.err)}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <ErrorBoundary>
      <AppInner />
    </ErrorBoundary>
  );
}

// ---------------- Excel parsing ----------------

function isProbablyHeaderRow(row) {
  const joined = (row || []).map((x) => String(x || "").toLowerCase()).join(" | ");
  return (
    joined.includes("momento") ||
    joined.includes("suplement") ||
    joined.includes("supplement") ||
    joined.includes("dosis") ||
    joined.includes("dose")
  );
}

function cleanStr(x) {
  return String(x ?? "").trim();
}

function normalizeHeader(h) {
  return cleanStr(h)
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

// Supports:
// Headered: Momento del día | Supplement | Dose
// Headerless: A=Momento, B=Supplement, C=Dose
function parseRoutineSheet(wb, sheetName, XLSX, srcTag) {
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];

  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
  const data = rows.filter((r) => (r || []).some((c) => cleanStr(c) !== ""));
  if (!data.length) return [];

  const hasHeader = isProbablyHeaderRow(data[0]);

  let out = [];
  if (hasHeader) {
    const header = data[0].map(normalizeHeader);

    const idxMom = header.findIndex((h) => h.includes("momento"));
    const idxSup =
      header.findIndex((h) => h.includes("supplement")) >= 0
        ? header.findIndex((h) => h.includes("supplement"))
        : header.findIndex((h) => h.includes("suplemento") || h.includes("suplement"));
    const idxDose = header.findIndex((h) => h.includes("dosis") || h.includes("dose"));
    const idxRule = header.findIndex((h) => h.includes("regla") || h.includes("rule"));
    const idxNotes = header.findIndex((h) => h.includes("nota") || h.includes("notes"));

    let currentMom = "";
    for (let i = 1; i < data.length; i++) {
      const r = data[i] || [];
      const mom = idxMom >= 0 ? cleanStr(r[idxMom]) : "";
      if (mom) currentMom = mom;

      const suplemento = idxSup >= 0 ? cleanStr(r[idxSup]) : "";
      if (!suplemento) continue;

      const dosis = idxDose >= 0 ? cleanStr(r[idxDose]) : "";
      const regla = idxRule >= 0 ? cleanStr(r[idxRule]) : "";
      const notas = idxNotes >= 0 ? cleanStr(r[idxNotes]) : "";

      out.push({
        momento: currentMom || "Sin momento",
        suplemento,
        dosis,
        regla,
        notas,
        canon: U.canonKey(suplemento),
        _src: srcTag,
        _ord: U.momentRank(currentMom) * 1000 + i,
      });
    }
  } else {
    // Headerless: A Momento, B Supplement, C Dose
    let currentMom = "";
    for (let i = 0; i < data.length; i++) {
      const r = data[i] || [];
      const colA = cleanStr(r[0]);
      const colB = cleanStr(r[1]);
      const colC = cleanStr(r[2]);

      if (colA) currentMom = colA;
      if (!colB) continue;

      out.push({
        momento: currentMom || "Sin momento",
        suplemento: colB,
        dosis: colC || "",
        regla: "",
        notas: "",
        canon: U.canonKey(colB),
        _src: srcTag,
        _ord: U.momentRank(currentMom) * 1000 + i,
      });
    }
  }

  // Generate stable-ish keys per momento+canon (dedupe with suffix)
  const seen = new Map();
  out = out.map((it) => {
    const base = `${it.momento}||${it.canon}`;
    const n = (seen.get(base) || 0) + 1;
    seen.set(base, n);
    const key = n === 1 ? base : `${base}||#${n}`;
    return { ...it, key };
  });

  return out;
}

// ---------------- App logic ----------------

function AppInner() {
  const todayISO = U.toISODate(new Date());
  const tomorrowISO = U.toISODate(U.addDays(new Date(), 1));

  // Persisted routines (so you don't re-upload)
  const [fileName, setFileName] = useState("");
  const [routine2, setRoutine2] = useState([]);
  const [routine3, setRoutine3] = useState([]);
  const [errorMsg, setErrorMsg] = useState("");

  // User-added items
  const [userRoutine, setUserRoutine] = useState(() =>
    U.safeJsonObject(localStorage.getItem(STORAGE_USER_ROUTINE), { items: [] })
  );

  // Cycles config per canon
  const [cycles, setCycles] = useState(() =>
    U.safeJsonObject(localStorage.getItem(STORAGE_CYCLES), {})
  );

  // Prices config per canon
  const [prices, setPrices] = useState(() =>
    U.safeJsonObject(localStorage.getItem(STORAGE_PRICES), {})
  );

  // Per-day choice: 2 or 3 meals
  const [mealsByDate, setMealsByDate] = useState(() =>
    U.safeJsonObject(localStorage.getItem(STORAGE_MEALS_BY_DATE), {})
  );

  // Default = taken; store only NOT taken
  const [notTaken, setNotTaken] = useState(() =>
    U.safeJsonObject(localStorage.getItem(STORAGE_NOT_TAKEN), {})
  );

  // UI state
  const [selectedDate, setSelectedDate] = useState(() => todayISO);
  const [monthCursor, setMonthCursor] = useState(() => U.startOfMonth(new Date()));
  const [yearCursor, setYearCursor] = useState(() => new Date().getFullYear());
  const [view, setView] = useState("day"); // day|week|month|cycles|add|costs
  const [showOff, setShowOff] = useState(false);

  // ---- Load persisted routines ----
  useEffect(() => {
    const saved = U.safeJsonObject(localStorage.getItem(STORAGE_ROUTINES), null);
    if (saved && typeof saved === "object") {
      if (Array.isArray(saved.routine2)) setRoutine2(saved.routine2);
      if (Array.isArray(saved.routine3)) setRoutine3(saved.routine3);
      if (saved.fileName) setFileName(saved.fileName);
    }
  }, []);

  // ---- Persist state ----
  useEffect(() => {
    localStorage.setItem(STORAGE_USER_ROUTINE, JSON.stringify(userRoutine || { items: [] }));
  }, [userRoutine]);

  useEffect(() => {
    localStorage.setItem(STORAGE_CYCLES, JSON.stringify(cycles || {}));
  }, [cycles]);

  useEffect(() => {
    localStorage.setItem(STORAGE_PRICES, JSON.stringify(prices || {}));
  }, [prices]);

  useEffect(() => {
    localStorage.setItem(STORAGE_MEALS_BY_DATE, JSON.stringify(mealsByDate || {}));
  }, [mealsByDate]);

  useEffect(() => {
    localStorage.setItem(STORAGE_NOT_TAKEN, JSON.stringify(notTaken || {}));
  }, [notTaken]);

  useEffect(() => {
    localStorage.setItem(
      STORAGE_ROUTINES,
      JSON.stringify({ fileName, routine2, routine3, savedAt: new Date().toISOString() })
    );
  }, [fileName, routine2, routine3]);

  function mealsForISO(iso) {
    const v = mealsByDate?.[iso];
    return v === 2 || v === 3 ? v : 3;
  }
  function setMealsForISO(iso, v) {
    setMealsByDate((prev) => {
      const p = prev && typeof prev === "object" ? prev : {};
      return { ...p, [iso]: v };
    });
  }

  const dayObj = useMemo(() => U.parseISODate(selectedDate) || new Date(), [selectedDate]);

  function cfgForCanon(canon) {
    const c = cycles?.[canon];
    return c && typeof c === "object" ? c : { mode: "none" };
  }

  function ensureDefaultsForCanon(canon, name) {
    setCycles((prev) => {
      const p = prev && typeof prev === "object" ? { ...prev } : {};
      if (p[canon]) return prev;

      const t = suggestCycleByName(name);
      if (t) {
        p[canon] = {
          name,
          mode: t.mode || "none",
          startISO: tomorrowISO,
          onDays: t.onDays ?? 90,
          offDays: t.offDays ?? 30,
          pauseDays: t.pauseDays ?? 0,
          // anchor for "cada N días"
          intervalAnchorISO: tomorrowISO,
        };
      } else {
        p[canon] = { name, mode: "none", startISO: tomorrowISO, onDays: 90, offDays: 30, pauseDays: 0, intervalAnchorISO: tomorrowISO };
      }
      return p;
    });
  }

  // Merge routine for given date: base (2c/3c) + user additions
  const routineForISO = useMemo(() => {
    const cache = new Map();
    return (iso) => {
      if (cache.has(iso)) return cache.get(iso);

      const base = mealsForISO(iso) === 2 ? routine2 : routine3;

      const extra = (userRoutine?.items || []).map((x, idx) => {
        const canon = U.canonKey(x.suplemento);
        return {
          momento: x.momento || "Sin momento",
          suplemento: x.suplemento,
          dosis: x.dosis || "",
          regla: x.regla || "",
          notas: x.notas || "",
          canon,
          key: x.key || `${x.momento || "Sin momento"}||${canon}||user||#${idx}`,
          _src: "user",
          _ord: U.momentRank(x.momento) * 1000 + 900 + idx,
        };
      });

      const merged = [...base, ...extra].sort((a, b) => (a._ord - b._ord) || a.suplemento.localeCompare(b.suplemento));
      cache.set(iso, merged);
      return merged;
    };
  }, [routine2, routine3, userRoutine, mealsByDate]);

  // All supplements list (for cycles/prices)
  const allSupp = useMemo(() => {
    const map = new Map();
    const addFrom = (arr) => {
      for (const it of arr) map.set(it.canon, it.suplemento);
    };
    addFrom(routine2);
    addFrom(routine3);
    for (const it of (userRoutine?.items || [])) {
      map.set(U.canonKey(it.suplemento), it.suplemento);
    }
    return Array.from(map.entries()).map(([canon, name]) => ({ canon, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [routine2, routine3, userRoutine]);

  // Ensure cycles defaults exist for known supplements (once routines appear)
  useEffect(() => {
    for (const s of allSupp) ensureDefaultsForCanon(s.canon, s.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSupp.length]);

  // ---------- “Taken” logic (default taken; only store notTaken) ----------
  function getNotTakenMap(iso) {
    const base = notTaken && typeof notTaken === "object" ? notTaken : {};
    return base[iso] || {};
  }

  function setNotTakenFor(iso, itemKey, value) {
    setNotTaken((prev) => {
      const p = prev && typeof prev === "object" ? prev : {};
      const day = { ...(p[iso] || {}) };
      if (value) day[itemKey] = true;
      else delete day[itemKey];
      return { ...p, [iso]: day };
    });
  }

  function assumeAllTaken(iso) {
    setNotTaken((prev) => {
      const p = prev && typeof prev === "object" ? prev : {};
      return { ...p, [iso]: {} };
    });
  }

  function markAllNotTaken(iso) {
    const planned = plannedItemsForISO(iso).filter((x) => x.status === "ON");
    setNotTaken((prev) => {
      const p = prev && typeof prev === "object" ? prev : {};
      const day = { ...(p[iso] || {}) };
      for (const it of planned) day[it.key] = true;
      return { ...p, [iso]: day };
    });
  }

  function isActuallyTaken(canon, iso, dateObj) {
    // if not planned that day, ignore
    if (!scheduledOnDate(canon, dateObj)) return false;
    // default taken unless marked NOT taken
    const day = getNotTakenMap(iso);
    // consider taken if no key for that canon is marked
    for (const [k, v] of Object.entries(day)) {
      if (v === true && String(k).includes(`||${canon}`)) return false;
    }
    return true;
  }

  // ---------- Schedule rules ----------
  function scheduledOnDate(canon, dateObj) {
    const iso = U.toISODate(dateObj);
    const routine = routineForISO(iso);
    const items = routine.filter((x) => x.canon === canon);
    if (!items.length) return false;

    const wd = U.isoWeekday(dateObj);
    for (const it of items) {
      const wds = U.extractWeekdaysFromText(it.dosis, it.regla, it.notas);
      if (wds && !wds.has(wd)) continue;

      // interval-days like "cada 2 días"
      const interval = U.extractIntervalDaysFromText(it.dosis, it.regla, it.notas);
      if (interval && interval > 1) {
        const cfg = cfgForCanon(canon);
        const anchorISO = cfg.intervalAnchorISO || cfg.startISO || tomorrowISO;
        const anchor = U.parseISODate(anchorISO);
        if (!anchor) continue;
        const diff = Math.floor((dateObj.getTime() - anchor.getTime()) / U.MS_DAY);
        if (diff < 0) continue;
        if (diff % interval !== 0) continue;
      }

      return true;
    }
    return false;
  }

  // ---------- Cycle status ----------
  function statusCalendar(canon, dateObj) {
    const cfg = cfgForCanon(canon);
    if (!cfg || cfg.mode === "none") return "ON";
    const start = U.parseISODate(cfg.startISO);
    if (!start) return "ON";

    const dayIndex = Math.floor((dateObj.getTime() - start.getTime()) / U.MS_DAY);
    if (dayIndex < 0) return "OFF";

    // initial pauseDays are OFF
    const pauseDays = Number(cfg.pauseDays || 0);
    if (dayIndex < pauseDays) return "OFF";

    const effective = dayIndex - pauseDays;
    const onDays = Number(cfg.onDays || 0);
    const offDays = Number(cfg.offDays || 0);
    const period = onDays + offDays;
    if (period <= 0 || onDays <= 0) return "ON";

    const pos = ((effective % period) + period) % period;
    return pos < onDays ? "ON" : "OFF";
  }

  // Precompute taken-mode calendar for the selected year (fast enough)
  const takenModeMapForYear = useMemo(() => {
    const yearStart = new Date(yearCursor, 0, 1);
    const yearEnd = new Date(yearCursor, 11, 31);
    const result = new Map();

    for (const s of allSupp) {
      const cfg = cfgForCanon(s.canon);
      if (cfg.mode !== "taken") continue;

      const start = U.parseISODate(cfg.startISO);
      if (!start) continue;

      const mapISO = new Map();

      let phase = "OFF";
      let offRem = Number(cfg.pauseDays || 0);
      let onCount = 0;
      if (offRem <= 0) phase = "ON";

      for (let d = new Date(start); d <= yearEnd; d = U.addDays(d, 1)) {
        const iso = U.toISODate(d);

        const statusNow = phase === "ON" ? "ON" : "OFF";
        if (d >= yearStart && d <= yearEnd) mapISO.set(iso, statusNow);

        let takenFlag = false;
        if (phase === "ON") {
          // for past days use actual; for future assume taken if scheduled
          if (iso <= todayISO) takenFlag = isActuallyTaken(s.canon, iso, d);
          else takenFlag = scheduledOnDate(s.canon, d);
        }

        if (phase === "OFF") {
          offRem -= 1;
          if (offRem <= 0) {
            phase = "ON";
            onCount = 0;
          }
        } else {
          if (takenFlag) onCount += 1;
          const onDays = Number(cfg.onDays || 0);
          const offDays = Number(cfg.offDays || 0);
          if (onDays > 0 && onCount >= onDays) {
            if (offDays > 0) {
              phase = "OFF";
              offRem = offDays;
            } else {
              phase = "ON";
              onCount = 0;
            }
          }
        }
      }

      result.set(s.canon, mapISO);
    }

    return result;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yearCursor, allSupp, cycles, notTaken, mealsByDate, routine2, routine3, userRoutine, selectedDate]);

  function statusForCanonOnDate(canon, dateObj) {
    const cfg = cfgForCanon(canon);
    if (!cfg || cfg.mode === "none") return "ON";
    if (cfg.mode === "calendar") return statusCalendar(canon, dateObj);
    if (cfg.mode === "taken") {
      const map = takenModeMapForYear.get(canon);
      const iso = U.toISODate(dateObj);
      return map?.get(iso) || "ON";
    }
    return "ON";
  }

  function phaseEndISO(canon, fromISO) {
    const from = U.parseISODate(fromISO) || new Date();
    const st0 = statusForCanonOnDate(canon, from);
    for (let i = 1; i <= 420; i++) {
      const d = U.addDays(from, i);
      const st = statusForCanonOnDate(canon, d);
      if (st !== st0) return U.toISODate(d);
    }
    return "—";
  }

  function phaseInfo(canon, fromISO) {
    const cfg = cfgForCanon(canon);
    const st = statusForCanonOnDate(canon, U.parseISODate(fromISO) || new Date());
    const end = phaseEndISO(canon, fromISO);

    let pauseDur = 0;
    if (st === "ON") pauseDur = Number(cfg.offDays || 0);
    else pauseDur = 0;

    return { status: st, phaseEnd: end, pauseDur };
  }

  function isPlannedForDate(dateObj, item) {
    // schedule rules
    const wdSet = U.extractWeekdaysFromText(item.dosis, item.regla, item.notas);
    if (wdSet && !wdSet.has(U.isoWeekday(dateObj))) return false;

    const interval = U.extractIntervalDaysFromText(item.dosis, item.regla, item.notas);
    if (interval && interval > 1) {
      const cfg = cfgForCanon(item.canon);
      const anchorISO = cfg.intervalAnchorISO || cfg.startISO || tomorrowISO;
      const anchor = U.parseISODate(anchorISO);
      if (anchor) {
        const diff = Math.floor((dateObj.getTime() - anchor.getTime()) / U.MS_DAY);
        if (diff < 0 || diff % interval !== 0) return false;
      }
    }

    const st = statusForCanonOnDate(item.canon, dateObj);
    if (st === "ON") return true;
    return showOff;
  }

  function plannedItemsForISO(dateISO) {
    const d = U.parseISODate(dateISO);
    if (!d) return [];
    const routine = routineForISO(dateISO);

    return routine
      .filter((ri) => isPlannedForDate(d, ri))
      .map((ri) => ({
        ...ri,
        status: statusForCanonOnDate(ri.canon, d),
        phaseEnd: phaseEndISO(ri.canon, dateISO),
      }))
      .sort((a, b) => (a._ord - b._ord) || a.suplemento.localeCompare(b.suplemento));
  }

  function completionForDate(dateObj) {
    const iso = U.toISODate(dateObj);
    const planned = plannedItemsForISO(iso).filter((x) => x.status === "ON");
    const nt = getNotTakenMap(iso);

    const plannedCount = planned.length;
    const notTakenCount = planned.filter((x) => nt[x.key]).length;
    const takenCount = plannedCount - notTakenCount;

    return { plannedCount, takenCount, ratio: plannedCount ? takenCount / plannedCount : 0 };
  }

  const plannedToday = useMemo(() => plannedItemsForISO(selectedDate), [selectedDate, routine2, routine3, userRoutine, cycles, showOff, mealsByDate, notTaken]);
  const notTakenToday = useMemo(() => getNotTakenMap(selectedDate), [notTaken, selectedDate]);

  const groupedByMomento = useMemo(() => {
    const g = new Map();
    for (const it of plannedToday) {
      if (!g.has(it.momento)) g.set(it.momento, []);
      g.get(it.momento).push(it);
    }
    return Array.from(g.entries());
  }, [plannedToday]);

  const weekDays = useMemo(() => {
    const start = U.startOfWeekMonday(dayObj);
    return Array.from({ length: 7 }, (_, i) => U.addDays(start, i));
  }, [dayObj]);

  const monthGrid = useMemo(() => {
    const first = U.startOfMonth(monthCursor);
    const last = U.endOfMonth(monthCursor);
    const pad = ((first.getDay() + 6) % 7);
    const cells = [];
    for (let i = 0; i < pad; i++) cells.push(null);
    for (let d = 1; d <= last.getDate(); d++) cells.push(new Date(first.getFullYear(), first.getMonth(), d));
    while (cells.length % 7 !== 0) cells.push(null);
    while (cells.length < 42) cells.push(null);
    return cells.slice(0, 42);
  }, [monthCursor]);

  async function handleUpload(file) {
    if (!file) return;
    setErrorMsg("");
    setFileName(file.name);

    try {
      const XLSX = await import("xlsx");
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });

      const sheetNames = wb.SheetNames || [];
      const norm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

      const sheet2 = sheetNames.find((s) => norm(s) === "2 comidas");
      const sheet3 = sheetNames.find((s) => norm(s) === "3 comidas");

      if (!sheet2 && !sheet3) {
        throw new Error(`No encuentro hojas "2 comidas" / "3 comidas". Hojas detectadas: ${sheetNames.join(", ")}`);
      }

      const r2 = sheet2 ? parseRoutineSheet(wb, sheet2, XLSX, "excel2") : [];
      const r3 = sheet3 ? parseRoutineSheet(wb, sheet3, XLSX, "excel3") : [];

      setRoutine2(r2);
      setRoutine3(r3);

      // initialize cycles defaults for any new supplements
      for (const it of [...r2, ...r3]) ensureDefaultsForCanon(it.canon, it.suplemento);

    } catch (e) {
      console.error(e);
      setErrorMsg(String(e?.stack || e?.message || e));
    }
  }

  function updateCycle(canon, patch) {
    setCycles((prev) => {
      const base = prev && typeof prev === "object" ? { ...prev } : {};
      base[canon] = { ...(base[canon] || { mode: "none", startISO: tomorrowISO, intervalAnchorISO: tomorrowISO }), ...patch };
      if (!base[canon].intervalAnchorISO) base[canon].intervalAnchorISO = base[canon].startISO || tomorrowISO;
      return base;
    });
  }

  // ---------- Costs ----------
  function unitPriceFor(canon) {
    const p = prices?.[canon];
    if (!p) return null;
    const priceEUR = Number(p.priceEUR || 0);
    const units = Number(p.units || 0);
    if (!priceEUR || !units) return null;
    return priceEUR / units;
  }

  function yearlyConsumptionUnits(canon) {
    // Sum over year: each planned ON day counts dose units.
    const yearStart = new Date(yearCursor, 0, 1);
    const yearEnd = new Date(yearCursor, 11, 31);

    let totalUnits = 0;

    for (let d = new Date(yearStart); d <= yearEnd; d = U.addDays(d, 1)) {
      const iso = U.toISODate(d);
      const items = routineForISO(iso).filter((x) => x.canon === canon);

      for (const it of items) {
        // only if planned and ON
        if (!isPlannedForDate(d, { ...it, canon })) continue;
        if (statusForCanonOnDate(canon, d) !== "ON") continue;

        const { qty } = U.parseDoseUnits(it.dosis);
        if (qty != null) totalUnits += qty;
        else totalUnits += 0; // unknown
      }
    }
    return totalUnits;
  }

  function costBreakdown(canon) {
    const up = unitPriceFor(canon);
    if (up == null) return { day: null, month: null, year: null, unitsYear: yearlyConsumptionUnits(canon) };

    const unitsYear = yearlyConsumptionUnits(canon);
    const yearCost = unitsYear * up;
    const dayCost = yearCost / 365;
    const monthCost = yearCost / 12;
    return { day: dayCost, month: monthCost, year: yearCost, unitsYear };
  }

  // ---------- Add supplement ----------
  const [newSupp, setNewSupp] = useState({
    suplemento: "",
    momento: "COMIDA",
    dosis: "",
    regla: "",
    notas: "",
    cycleMode: "none",
    startISO: tomorrowISO,
    onDays: 90,
    offDays: 30,
    pauseDays: 0,
    suggestedLabel: "",
  });

  function applySuggestedCycle() {
    const t = suggestCycleByName(newSupp.suplemento);
    if (!t) {
      setNewSupp((p) => ({ ...p, suggestedLabel: "Sin plantilla. Configura manualmente si quieres." }));
      return;
    }
    setNewSupp((p) => ({
      ...p,
      cycleMode: t.mode,
      onDays: t.onDays ?? p.onDays,
      offDays: t.offDays ?? p.offDays,
      pauseDays: t.pauseDays ?? p.pauseDays,
      suggestedLabel: `Aplicada: ${t.label}`,
    }));
  }

  function addSupplement() {
    const name = newSupp.suplemento.trim();
    if (!name) return;

    const canon = U.canonKey(name);
    const momento = newSupp.momento.trim() || "Sin momento";

    const key = `${momento}||${canon}||user||${Date.now()}`;

    setUserRoutine((prev) => {
      const base = prev && typeof prev === "object" ? prev : { items: [] };
      const items = Array.isArray(base.items) ? [...base.items] : [];
      items.push({
        key,
        suplemento: name,
        momento,
        dosis: newSupp.dosis || "",
        regla: newSupp.regla || "",
        notas: newSupp.notas || "",
      });
      return { ...base, items };
    });

    // apply cycle if selected
    if (newSupp.cycleMode && newSupp.cycleMode !== "none") {
      updateCycle(canon, {
        name,
        mode: newSupp.cycleMode,
        startISO: newSupp.startISO || tomorrowISO,
        onDays: Number(newSupp.onDays) || 90,
        offDays: Number(newSupp.offDays) || 30,
        pauseDays: Number(newSupp.pauseDays) || 0,
        intervalAnchorISO: newSupp.startISO || tomorrowISO,
      });
    } else {
      // ensure exists (none)
      ensureDefaultsForCanon(canon, name);
    }

    setNewSupp((p) => ({ ...p, suplemento: "", dosis: "", regla: "", notas: "", suggestedLabel: "" }));
    setView("day");
  }

  const navItems = [
    { k: "day", label: "Día" },
    { k: "week", label: "Semana" },
    { k: "month", label: "Mes" },
    { k: "cycles", label: "Ciclos" },
    { k: "costs", label: "Costes" },
    { k: "add", label: "Añadir" },
  ];

  const hasAnyRoutine = routine2.length || routine3.length || (userRoutine?.items || []).length;

  return (
    <div className="app">
      <header className="topbar">
        <div>
          <div className="app-title">Suplementos Planner</div>
          <div className="app-subtitle">
            Persistente · 2/3 comidas · Ciclos ON/OFF · Por defecto: <b>tomado</b> (marca solo lo <b>NO tomado</b>)
          </div>
        </div>

        <div className="topbar-right">
          <label className="btn">
            <input
              type="file"
              accept=".xlsx,.xls"
              style={{ display: "none" }}
              onChange={(e) => handleUpload(e.target.files?.[0])}
            />
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

      {!hasAnyRoutine ? (
        <div className="card">
          <div className="cardTitle">Sube tu Excel o añade suplementos</div>
          <div className="muted">La app busca hojas “2 comidas” y “3 comidas”.</div>
        </div>
      ) : null}

      {/* DAY */}
      {view === "day" ? (
        <div className="card">
          <div className="row">
            <div>
              <div className="cardTitle">Checklist del día</div>
              <div className="muted">{selectedDate}</div>
            </div>
            <div className="row">
              <input className="date" type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
            </div>
          </div>

          <div className="row" style={{ marginTop: 8 }}>
            <div className="muted">Tipo de día:</div>
            <div className="seg">
              <button className={mealsForISO(selectedDate) === 2 ? "segBtn segOn" : "segBtn"} onClick={() => setMealsForISO(selectedDate, 2)}>
                2 comidas
              </button>
              <button className={mealsForISO(selectedDate) === 3 ? "segBtn segOn" : "segBtn"} onClick={() => setMealsForISO(selectedDate, 3)}>
                3 comidas
              </button>
            </div>
          </div>

          {(() => {
            const c = completionForDate(dayObj);
            return (
              <div className="row" style={{ marginTop: 10 }}>
                <div className="muted">
                  Completado: <b>{c.takenCount}</b> / <b>{c.plannedCount}</b>
                </div>
                <div className="progressWrap">
                  <Progress ratio={c.ratio} />
                </div>
              </div>
            );
          })()}

          <div className="row" style={{ marginTop: 10 }}>
            <button className="btnPrimary" onClick={() => assumeAllTaken(selectedDate)}>Asumir todo tomado</button>
            <button className="btnGhost" onClick={() => markAllNotTaken(selectedDate)}>Marcar todo NO tomado</button>
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
                    const info = phaseInfo(it.canon, selectedDate);

                    return (
                      <label key={it.key} className={isOff ? "item itemOff" : "item"}>
                        {/* Checkbox means NOT taken */}
                        <input
                          type="checkbox"
                          disabled={isOff}
                          checked={!!notTakenToday[it.key]}
                          onChange={(e) => setNotTakenFor(selectedDate, it.key, e.target.checked)}
                          title="Marca si NO lo has tomado"
                        />
                        <div className="itemBody">
                          <div className="itemTop">
                            <div className="itemName">{it.suplemento}</div>
                            <div className="itemBadges">
                              {it.dosis ? <Pill>{it.dosis}</Pill> : null}
                              {isOff ? <Pill tone="off">OFF</Pill> : <Pill tone="on">ON</Pill>}
                              <Pill tone="info">Fin fase: {info.phaseEnd}</Pill>
                              {it.status === "ON" && Number(cfgForCanon(it.canon)?.offDays || 0) > 0 ? (
                                <Pill tone="info">Pausa: {Number(cfgForCanon(it.canon)?.offDays || 0)}d</Pill>
                              ) : null}
                            </div>
                          </div>
                          {it.regla ? <div className="muted">{it.regla}</div> : null}
                          {it.notas ? <div className="note">{it.notas}</div> : null}
                          {!!notTakenToday[it.key] ? <div className="note" style={{ borderStyle: "solid", borderColor: "rgba(255,77,109,.35)" }}>Marcado como: <b>NO tomado</b></div> : null}
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

      {/* WEEK */}
      {view === "week" ? (
        <div className="card">
          <div className="row">
            <div className="cardTitle">Vista semanal</div>
            <input className="date" type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} />
          </div>

          <div className="cards">
            {weekDays.map((d) => {
              const iso = U.toISODate(d);
              const c = completionForDate(d);
              const meals = mealsForISO(iso);
              return (
                <button key={iso} className="dayCard" onClick={() => { setSelectedDate(iso); setView("day"); }}>
                  <div className="dayCardTop">
                    <div className="dayCardTitle">
                      {d.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short" })}
                    </div>
                    <Pill>{meals}C</Pill>
                  </div>
                  <div className="muted">{c.takenCount}/{c.plannedCount}</div>
                  <Progress ratio={c.ratio} />
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* MONTH */}
      {view === "month" ? (
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
              const iso = U.toISODate(d);
              const c = completionForDate(d);
              const meals = mealsForISO(iso);
              return (
                <button key={iso} className="monthCell" onClick={() => { setSelectedDate(iso); setView("day"); }}>
                  <div className="monthCellTop">
                    <div className="dayNum">{d.getDate()}</div>
                    <Pill>{meals}C</Pill>
                  </div>
                  <div className="muted small">{c.takenCount}/{c.plannedCount}</div>
                  <div className="muted small">{Math.round(c.ratio * 100)}%</div>
                </button>
              );
            })}
          </div>
        </div>
      ) : null}

      {/* CYCLES */}
      {view === "cycles" ? (
        <div className="card">
          <div className="row">
            <div>
              <div className="cardTitle">Ciclos (editable)</div>
              <div className="muted">
                <b>calendar</b>: rotación fija por fecha · <b>taken</b>: el ON se alarga si marcas “NO tomado”
              </div>
            </div>
            <div className="row">
              <div className="muted">Año:</div>
              <input className="inp" style={{ width: 110 }} value={yearCursor} onChange={(e) => setYearCursor(Number(e.target.value || new Date().getFullYear()))} />
            </div>
          </div>

          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Suplemento</th>
                  <th>Modo</th>
                  <th>Inicio</th>
                  <th className="num">ON</th>
                  <th className="num">OFF</th>
                  <th className="num">Pausa inicial</th>
                  <th>Estado hoy</th>
                  <th>Fin fase</th>
                  <th>Duración próxima pausa</th>
                  <th>Anchor “cada N días”</th>
                </tr>
              </thead>
              <tbody>
                {allSupp.map((s) => {
                  const c = cfgForCanon(s.canon);
                  const st = statusForCanonOnDate(s.canon, new Date());
                  const end = phaseEndISO(s.canon, todayISO);
                  const nextPauseDur = st === "ON" ? Number(c.offDays || 0) : 0;

                  return (
                    <tr key={s.canon}>
                      <td className="nameCell">
                        <div className="nameMain">{s.name}</div>
                      </td>
                      <td>
                        <select className="sel" value={c.mode || "none"} onChange={(e) => updateCycle(s.canon, { name: s.name, mode: e.target.value })}>
                          <option value="none">none</option>
                          <option value="calendar">calendar</option>
                          <option value="taken">taken</option>
                        </select>
                      </td>
                      <td>
                        <input className="date" type="date" value={c.startISO || tomorrowISO} onChange={(e) => updateCycle(s.canon, { name: s.name, startISO: e.target.value })} />
                      </td>
                      <td className="num">
                        <input className="inp" inputMode="numeric" value={c.onDays ?? ""} onChange={(e) => updateCycle(s.canon, { onDays: Number(e.target.value || 0) })} />
                      </td>
                      <td className="num">
                        <input className="inp" inputMode="numeric" value={c.offDays ?? ""} onChange={(e) => updateCycle(s.canon, { offDays: Number(e.target.value || 0) })} />
                      </td>
                      <td className="num">
                        <input className="inp" inputMode="numeric" value={c.pauseDays ?? 0} onChange={(e) => updateCycle(s.canon, { pauseDays: Number(e.target.value || 0) })} />
                      </td>
                      <td>{st === "ON" ? <Pill tone="on">ON</Pill> : <Pill tone="off">OFF</Pill>}</td>
                      <td className="muted">{end}</td>
                      <td className="muted">{nextPauseDur ? `${nextPauseDur} días` : "—"}</td>
                      <td>
                        <input className="date" type="date" value={c.intervalAnchorISO || c.startISO || tomorrowISO} onChange={(e) => updateCycle(s.canon, { intervalAnchorISO: e.target.value })} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* COSTS */}
      {view === "costs" ? (
        <div className="card">
          <div className="row">
            <div>
              <div className="cardTitle">Costes</div>
              <div className="muted">Introduce precio y unidades por producto (cápsulas o gramos). La app estima coste día/mes/año.</div>
            </div>
            <div className="row">
              <div className="muted">Año:</div>
              <input className="inp" style={{ width: 110 }} value={yearCursor} onChange={(e) => setYearCursor(Number(e.target.value || new Date().getFullYear()))} />
            </div>
          </div>

          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Suplemento</th>
                  <th className="num">Precio €</th>
                  <th className="num">Unidades</th>
                  <th>Tipo</th>
                  <th className="num">Unid/año</th>
                  <th className="num">€/día</th>
                  <th className="num">€/mes</th>
                  <th className="num">€/año</th>
                </tr>
              </thead>
              <tbody>
                {allSupp.map((s) => {
                  const p = prices?.[s.canon] || { priceEUR: "", units: "", unitType: "caps" };
                  const b = costBreakdown(s.canon);

                  return (
                    <tr key={s.canon}>
                      <td><div className="nameMain">{s.name}</div></td>
                      <td className="num">
                        <input
                          className="inp"
                          inputMode="decimal"
                          value={p.priceEUR ?? ""}
                          onChange={(e) => setPrices((prev) => ({ ...(prev || {}), [s.canon]: { ...(prev?.[s.canon] || {}), priceEUR: e.target.value } }))}
                        />
                      </td>
                      <td className="num">
                        <input
                          className="inp"
                          inputMode="numeric"
                          value={p.units ?? ""}
                          onChange={(e) => setPrices((prev) => ({ ...(prev || {}), [s.canon]: { ...(prev?.[s.canon] || {}), units: e.target.value } }))}
                        />
                      </td>
                      <td>
                        <select
                          className="sel"
                          value={p.unitType || "caps"}
                          onChange={(e) => setPrices((prev) => ({ ...(prev || {}), [s.canon]: { ...(prev?.[s.canon] || {}), unitType: e.target.value } }))}
                        >
                          <option value="caps">cápsulas</option>
                          <option value="g">gramos</option>
                        </select>
                      </td>
                      <td className="num">{Math.round((b.unitsYear || 0) * 10) / 10}</td>
                      <td className="num">{b.day == null ? "—" : (Math.round(b.day * 100) / 100).toFixed(2)}</td>
                      <td className="num">{b.month == null ? "—" : (Math.round(b.month * 100) / 100).toFixed(2)}</td>
                      <td className="num">{b.year == null ? "—" : (Math.round(b.year * 100) / 100).toFixed(2)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="muted" style={{ marginTop: 10 }}>
            Nota: si una dosis no es interpretable (p.ej. texto sin número), “Unid/año” puede quedar infravalorado.
          </div>
        </div>
      ) : null}

      {/* ADD */}
      {view === "add" ? (
        <div className="card">
          <div className="cardTitle">Añadir suplemento</div>
          <div className="muted">Añade sin tocar el Excel. Se guardará localmente.</div>

          <div className="formGrid">
            <div>
              <div className="muted small">Suplemento</div>
              <input className="inpWide" value={newSupp.suplemento} onChange={(e) => setNewSupp((p) => ({ ...p, suplemento: e.target.value }))} placeholder="Ej: UC-II" />
            </div>
            <div>
              <div className="muted small">Momento</div>
              <input className="inpWide" value={newSupp.momento} onChange={(e) => setNewSupp((p) => ({ ...p, momento: e.target.value }))} placeholder="Ej: COMIDA" />
            </div>
            <div>
              <div className="muted small">Dosis</div>
              <input className="inpWide" value={newSupp.dosis} onChange={(e) => setNewSupp((p) => ({ ...p, dosis: e.target.value }))} placeholder="Ej: 1 cápsula" />
            </div>
            <div>
              <div className="muted small">Regla (opcional)</div>
              <input className="inpWide" value={newSupp.regla} onChange={(e) => setNewSupp((p) => ({ ...p, regla: e.target.value }))} placeholder="Ej: Lun/Mie/Vie" />
            </div>
            <div>
              <div className="muted small">Notas (opcional)</div>
              <input className="inpWide" value={newSupp.notas} onChange={(e) => setNewSupp((p) => ({ ...p, notas: e.target.value }))} placeholder="Ej: con comida" />
            </div>
          </div>

          <div className="divider" />

          <div className="row">
            <button className="btnGhost" onClick={applySuggestedCycle}>Sugerir ciclo</button>
            <div className="muted">{newSupp.suggestedLabel}</div>
          </div>

          <div className="row" style={{ marginTop: 10 }}>
            <div className="muted">Ciclo:</div>
            <select className="sel" style={{ maxWidth: 220 }} value={newSupp.cycleMode} onChange={(e) => setNewSupp((p) => ({ ...p, cycleMode: e.target.value }))}>
              <option value="none">none (siempre ON)</option>
              <option value="calendar">calendar</option>
              <option value="taken">taken</option>
            </select>

            <div className="muted">Inicio:</div>
            <input className="date" type="date" value={newSupp.startISO} onChange={(e) => setNewSupp((p) => ({ ...p, startISO: e.target.value }))} />

            <div className="muted">ON</div>
            <input className="inp" style={{ width: 90 }} value={newSupp.onDays} onChange={(e) => setNewSupp((p) => ({ ...p, onDays: e.target.value }))} />

            <div className="muted">OFF</div>
            <input className="inp" style={{ width: 90 }} value={newSupp.offDays} onChange={(e) => setNewSupp((p) => ({ ...p, offDays: e.target.value }))} />
          </div>

          <div className="row" style={{ marginTop: 10 }}>
            <div className="muted">Pausa inicial</div>
            <input className="inp" style={{ width: 110 }} value={newSupp.pauseDays} onChange={(e) => setNewSupp((p) => ({ ...p, pauseDays: e.target.value }))} />
          </div>

          <div className="row" style={{ marginTop: 12 }}>
            <button className="btnPrimary" onClick={addSupplement}>Guardar suplemento</button>
            <button className="btnGhost" onClick={() => setView("day")}>Cancelar</button>
          </div>
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

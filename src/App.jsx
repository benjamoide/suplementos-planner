import React, { useEffect, useMemo, useState } from "react";
import * as XLSX from "xlsx";

// Suplementos Planner
// - Upload Excel (recommended: Plan_Anual_Suplementos_Calendario_v2.xlsx)
// - Daily/Weekly/Monthly/Annual views
// - Checklist per day (persisted in localStorage)

const STORAGE_KEY = "supplementsPlanner:taken:v1";

function toISODate(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function isAllDigits(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 48 || c > 57) return false;
  }
  return true;
}

function parseISODate(v) {
  if (!v) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v;

  if (typeof v === "number") {
    const dt = XLSX.SSF.parse_date_code(v);
    if (!dt) return null;
    return new Date(dt.y, dt.m - 1, dt.d);
  }

  const s = String(v).trim();

  // YYYY-MM-DD
  if (s.length === 10 && s[4] === "-" && s[7] === "-") {
    const y = s.slice(0, 4);
    const m = s.slice(5, 7);
    const d = s.slice(8, 10);
    if (isAllDigits(y) && isAllDigits(m) && isAllDigits(d)) {
      return new Date(Number(y), Number(m) - 1, Number(d));
    }
  }

  // DD/MM/YYYY
  if (s.length === 10 && s[2] === "/" && s[5] === "/") {
    const d = s.slice(0, 2);
    const m = s.slice(3, 5);
    const y = s.slice(6, 10);
    if (isAllDigits(y) && isAllDigits(m) && isAllDigits(d)) {
      return new Date(Number(y), Number(m) - 1, Number(d));
    }
  }

  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

function startOfWeekMonday(d) {
  const wd = d.getDay(); // Sun=0
  const delta = wd === 0 ? -6 : 1 - wd;
  const x = new Date(d);
  x.setDate(x.getDate() + delta);
  x.setHours(0, 0, 0, 0);
  return x;
}

function weekdayMonday1(d) {
  const js = d.getDay();
  return js === 0 ? 7 : js;
}

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

function safeJsonParse(s, fallback) {
  try {
    return JSON.parse(s);
  } catch {
    return fallback;
  }
}

function computeStatusForDate(date, p) {
  const sd = p.startDate;
  if (!sd || !p.onDays || p.offDays === undefined || p.offDays === null) return "";
  const dayIndex = Math.floor((date.getTime() - sd.getTime()) / (1000 * 60 * 60 * 24));
  if (dayIndex < 0) return "";
  if (dayIndex < (p.pauseDays || 0)) return "OFF";
  const effective = dayIndex - (p.pauseDays || 0);
  const period = p.onDays + p.offDays;
  if (period <= 0) return "";
  const pos = ((effective % period) + period) % period;
  return pos < p.onDays ? "ON" : "OFF";
}

function classForStatus(status) {
  if (status === "ON") return "bg-green-100 text-green-900 border-green-200";
  if (status === "OFF") return "bg-gray-100 text-gray-700 border-gray-200";
  return "bg-white text-gray-800 border-gray-200";
}

function Pill({ children, status }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${classForStatus(status)}`}>
      {children}
    </span>
  );
}

function Progress({ value }) {
  const pct = clamp(Math.round((value || 0) * 100), 0, 100);
  return (
    <div className="w-full">
      <div className="h-2 w-full rounded-full bg-gray-100">
        <div className="h-2 rounded-full bg-gray-900" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-1 text-[11px] text-gray-600">{pct}%</div>
    </div>
  );
}

function Section({ title, right, children }) {
  return (
    <div className="rounded-2xl bg-white shadow-sm ring-1 ring-gray-200">
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <h2 className="text-base font-semibold text-gray-900">{title}</h2>
        {right}
      </div>
      <div className="p-4">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, label, sub }) {
  return (
    <label className="flex items-start gap-2 text-sm text-gray-800">
      <input
        type="checkbox"
        className="mt-1 h-4 w-4 rounded border-gray-300"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="min-w-0">
        <span className="block truncate" title={label}>{label}</span>
        {sub ? <span className="block text-xs text-gray-500">{sub}</span> : null}
      </span>
    </label>
  );
}

function Tabs({ value, onChange, items }) {
  return (
    <div className="inline-flex rounded-xl bg-gray-100 p-1">
      {items.map((it) => (
        <button
          key={it.value}
          onClick={() => onChange(it.value)}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${value === it.value ? "bg-white shadow-sm text-gray-900" : "text-gray-600 hover:text-gray-800"}`}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

function Modal({ open, title, onClose, children }) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />
      <div className="relative w-full max-w-5xl rounded-2xl bg-white shadow-xl ring-1 ring-gray-200">
        <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
          <h3 className="text-base font-semibold text-gray-900">{title}</h3>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-gray-600 hover:bg-gray-100">Cerrar</button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}

function normalizeKey(s) {
  return String(s || "").trim();
}

function readSheetAsJson(wb, sheetName) {
  const ws = wb.Sheets[sheetName];
  if (!ws) return [];
  return XLSX.utils.sheet_to_json(ws, { defval: "" });
}

function findFirstMatchingSheet(wb, candidates) {
  const names = wb.SheetNames || [];
  for (const c of candidates) {
    const hit = names.find((n) => n.toLowerCase() === c.toLowerCase());
    if (hit) return hit;
  }
  for (const c of candidates) {
    const hit = names.find((n) => n.toLowerCase().includes(c.toLowerCase()));
    if (hit) return hit;
  }
  return null;
}

function normalizeParametros(rows) {
  return rows
    .map((r) => {
      const name = r["Suplemento"] || r["SUPLEMENTO"] || r["Supplement"];
      const startDate = parseISODate(r["Inicio ciclo (fecha)"] || r["Inicio ciclo"] || r["Inicio"]);
      const onDays = Number(r["ON (días)"] || r["ON"] || r["ON (dias)"] || r["ON dias"]);
      const offDays = Number(r["OFF (días)"] || r["OFF"] || r["OFF (dias)"] || r["OFF dias"]);
      const pauseDays = Number(r["Pausa inicial (días)"] || r["Pausa inicial"] || 0);
      const abrev = r["Abrev"] || "";
      const notes = r["Notas"] || "";
      if (!name) return null;
      if (!Number.isFinite(onDays) || !Number.isFinite(offDays)) return null;
      return {
        name: normalizeKey(name),
        startDate: startDate || null,
        onDays: clamp(onDays, 1, 3650),
        offDays: clamp(offDays, 0, 3650),
        pauseDays: clamp(Number.isFinite(pauseDays) ? pauseDays : 0, 0, 3650),
        abrev: normalizeKey(abrev),
        notes: normalizeKey(notes),
      };
    })
    .filter(Boolean);
}

function normalizeRutina(rows) {
  const order = {
    Ayunas: 1,
    "A primera hora antes entreno": 1,
    "Post-entrenamiento / diario": 2,
    "Post-entrenamiento": 2,
    "Post Entrenamiento": 2,
    "ANTES DE DESAYUNO (30 MIN)": 3,
    "Antes de desayuno (30 min)": 3,
    Desayuno: 4,
    "ANTES DE COMER (30 MIN)": 5,
    "Antes de comer (30 min)": 5,
    Comida: 6,
    Cena: 7,
    "Antes de dormir": 8,
    Noche: 8,
  };

  return rows
    .map((r) => {
      const momento = r["Momento"] || r["Momento del Día"] || r["Momento del Dia"] || r["Momento del día"] || "";
      const suplemento = r["Suplemento"] || r["Suplementos"] || r["Supplement"] || "";
      const dosis = r["Dosis"] || r["Dose"] || "";
      const regla = r["Regla"] || r["Rule"] || "";
      const notas = r["Notas"] || r["Notes"] || "";
      if (!suplemento) return null;
      const momentoNorm = normalizeKey(momento);
      const suplementoNorm = normalizeKey(suplemento);
      const key = `${momentoNorm}||${suplementoNorm}`;
      return {
        key,
        momento: momentoNorm,
        suplemento: suplementoNorm,
        dosis: normalizeKey(dosis),
        regla: normalizeKey(regla),
        notas: normalizeKey(notas),
        _ord: order[momentoNorm] ?? 99,
      };
    })
    .filter(Boolean)
    .sort((a, b) => a._ord - b._ord || a.suplemento.localeCompare(b.suplemento));
}

export default function App() {
  const [fileName, setFileName] = useState("");
  const [params, setParams] = useState([]);
  const [routine, setRoutine] = useState([]);
  const [selectedSupp, setSelectedSupp] = useState({});

  const [view, setView] = useState("daily");
  const [monthCursor, setMonthCursor] = useState(() => startOfMonth(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => toISODate(new Date()));
  const [editOpen, setEditOpen] = useState(false);

  const [taken, setTaken] = useState(() => safeJsonParse(localStorage.getItem(STORAGE_KEY), {}));

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(taken));
  }, [taken]);

  const hasData = params.length > 0 || routine.length > 0;

  const paramByName = useMemo(() => {
    const m = new Map();
    params.forEach((p) => m.set(p.name, p));
    return m;
  }, [params]);

  const allSuppNames = useMemo(() => {
    const set = new Set();
    routine.forEach((r) => set.add(r.suplemento));
    params.forEach((p) => set.add(p.name));
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [routine, params]);

  useEffect(() => {
    if (!allSuppNames.length) return;
    setSelectedSupp((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const n of allSuppNames) {
        if (!(n in next)) {
          next[n] = true;
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [allSuppNames]);

  const todayIso = toISODate(new Date());

  function getTakenMapForDate(dateIso) {
    return taken[dateIso] || {};
  }

  function setTakenFor(dateIso, itemKey, value) {
    setTaken((prev) => {
      const day = { ...(prev[dateIso] || {}) };
      if (value) day[itemKey] = true;
      else delete day[itemKey];
      return { ...prev, [dateIso]: day };
    });
  }

  function markAllForDate(dateIso) {
    const planned = getPlannedItemsForDate(dateIso);
    setTaken((prev) => {
      const day = { ...(prev[dateIso] || {}) };
      for (const it of planned) day[it.key] = true;
      return { ...prev, [dateIso]: day };
    });
  }

  function clearDate(dateIso) {
    setTaken((prev) => ({ ...prev, [dateIso]: {} }));
  }

  function isPlannedForDate(dateObj, routineItem) {
    if (!routineItem) return false;
    if (selectedSupp[routineItem.suplemento] === false) return false;
    const p = paramByName.get(routineItem.suplemento);
    if (!p) return true;
    return computeStatusForDate(dateObj, p) === "ON";
  }

  function getPlannedItemsForDate(dateIso) {
    const d = parseISODate(dateIso);
    if (!d) return [];
    return routine.filter((ri) => isPlannedForDate(d, ri));
  }

  function completionForDate(dateObj) {
    const iso = toISODate(dateObj);
    const planned = getPlannedItemsForDate(iso);
    const takenMap = getTakenMapForDate(iso);
    const plannedCount = planned.length;
    const takenCount = planned.filter((p) => takenMap[p.key]).length;
    return { plannedCount, takenCount, ratio: plannedCount ? takenCount / plannedCount : 0 };
  }

  const weekDays = useMemo(() => {
    const d = parseISODate(selectedDate) || new Date();
    const start = startOfWeekMonday(d);
    return Array.from({ length: 7 }, (_, i) => addDays(start, i));
  }, [selectedDate]);

  const monthGrid = useMemo(() => {
    const first = startOfMonth(monthCursor);
    const last = endOfMonth(monthCursor);
    const startPad = weekdayMonday1(first) - 1;
    const totalDays = last.getDate();
    const cells = [];
    for (let i = 0; i < startPad; i++) cells.push(null);
    for (let d = 1; d <= totalDays; d++) cells.push(new Date(first.getFullYear(), first.getMonth(), d));
    while (cells.length % 7 !== 0) cells.push(null);
    while (cells.length < 42) cells.push(null);
    return cells.slice(0, 42);
  }, [monthCursor]);

  const routineGrouped = useMemo(() => {
    const g = new Map();
    for (const it of routine) {
      if (!g.has(it.momento)) g.set(it.momento, []);
      g.get(it.momento).push(it);
    }
    return Array.from(g.entries());
  }, [routine]);

  const annualSummary = useMemo(() => {
    const base = startOfMonth(monthCursor);
    const year = base.getFullYear();
    const out = [];
    for (let m = 0; m < 12; m++) {
      const ms = new Date(year, m, 1);
      const me = endOfMonth(ms);
      let planned = 0;
      let done = 0;
      for (let d = 1; d <= me.getDate(); d++) {
        const dt = new Date(year, m, d);
        const c = completionForDate(dt);
        planned += c.plannedCount;
        done += c.takenCount;
      }
      out.push({ month: ms, ratio: planned ? done / planned : 0 });
    }
    return out;
  }, [monthCursor, routine, params, selectedSupp, taken]);

  async function handleUpload(file) {
    if (!file) return;
    setFileName(file.name);
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: "array", cellDates: true });

    const parametrosName = findFirstMatchingSheet(wb, ["Parametros"]);
    const rutinaName =
      findFirstMatchingSheet(wb, ["Rutina_Diaria", "Rutina", "Plan", "Suplementos", "Input"]) ||
      (wb.SheetNames && wb.SheetNames.length ? wb.SheetNames[0] : null);

    const parametrosRows = parametrosName ? readSheetAsJson(wb, parametrosName) : [];
    const rutinaRows = rutinaName ? readSheetAsJson(wb, rutinaName) : [];

    const p = normalizeParametros(parametrosRows);
    const r = normalizeRutina(rutinaRows);

    setParams(p);
    setRoutine(r);

    const sel = {};
    const set = new Set();
    r.forEach((x) => set.add(x.suplemento));
    p.forEach((x) => set.add(x.name));
    Array.from(set).forEach((n) => (sel[n] = true));
    setSelectedSupp(sel);

    setMonthCursor(startOfMonth(new Date()));
    setSelectedDate(toISODate(new Date()));
  }

  function updateParam(name, patch) {
    setParams((prev) => prev.map((p) => (p.name === name ? { ...p, ...patch } : p)));
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-7xl px-4 py-6">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className="text-xl font-semibold text-gray-900">Suplementos Planner</h1>
            <p className="text-sm text-gray-600">
              App visual (gratis) para móvil: checklist + calendario. Todo se guarda localmente en el navegador.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-2 rounded-xl bg-white px-3 py-2 text-sm shadow-sm ring-1 ring-gray-200 hover:bg-gray-50 cursor-pointer">
              <input type="file" accept=".xlsx,.xls" className="hidden" onChange={(e) => handleUpload(e.target.files && e.target.files[0])} />
              <span className="font-medium">Subir Excel</span>
              <span className="text-gray-500">{fileName ? `(${fileName})` : ""}</span>
            </label>
            <button
              onClick={() => setEditOpen(true)}
              disabled={!params.length}
              className={`rounded-xl px-3 py-2 text-sm font-medium shadow-sm ring-1 ring-gray-200 ${params.length ? "bg-white hover:bg-gray-50" : "bg-gray-100 text-gray-400"}`}
            >
              Editar ciclos
            </button>
            <Tabs
              value={view}
              onChange={setView}
              items={[
                { value: "daily", label: "Día" },
                { value: "weekly", label: "Semana" },
                { value: "monthly", label: "Mes" },
                { value: "annual", label: "Año" },
                { value: "routine", label: "Rutina" },
              ]}
            />
          </div>
        </div>

        {!hasData ? (
          <div className="mt-6 rounded-2xl border border-dashed border-gray-300 bg-white p-6 text-sm text-gray-700">
            <div className="font-semibold text-gray-900">Qué Excel subir</div>
            <ul className="mt-2 list-disc pl-5 space-y-1">
              <li>
                Para que la app sepa qué suplementos van <span className="font-semibold">cíclicos</span> (ON/OFF), sube el Excel generado del plan anual (hojas “Parametros” y “Rutina_Diaria”).
              </li>
              <li>
                Si subes tu Excel original sin “Parametros”, la app mostrará rutina, pero asumirá todo como continuo.
              </li>
            </ul>
            <div className="mt-3 text-gray-500">
              Las marcas de “tomado” se guardan en el móvil/PC (localStorage). No necesitas subir el Excel cada día.
            </div>
          </div>
        ) : (
          <div className="mt-6 grid grid-cols-1 gap-4 lg:grid-cols-12">
            <div className="lg:col-span-3 space-y-4">
              <Section
                title="Filtros"
                right={
                  <div className="flex gap-2">
                    <button
                      className="text-xs text-gray-600 hover:text-gray-900"
                      onClick={() => {
                        const sel = {};
                        allSuppNames.forEach((n) => (sel[n] = true));
                        setSelectedSupp(sel);
                      }}
                    >
                      Todo
                    </button>
                    <span className="text-xs text-gray-300">|</span>
                    <button
                      className="text-xs text-gray-600 hover:text-gray-900"
                      onClick={() => {
                        const sel = {};
                        allSuppNames.forEach((n) => (sel[n] = false));
                        setSelectedSupp(sel);
                      }}
                    >
                      Nada
                    </button>
                  </div>
                }
              >
                <div className="space-y-2 max-h-[60vh] overflow-auto pr-1">
                  {allSuppNames.map((n) => {
                    const ab = paramByName.get(n)?.abrev;
                    const cyc = paramByName.get(n);
                    return (
                      <Toggle
                        key={n}
                        checked={selectedSupp[n] !== false}
                        onChange={(v) => setSelectedSupp((s) => ({ ...s, [n]: v }))}
                        label={ab ? `${ab} · ${n}` : n}
                        sub={cyc ? `${cyc.onDays} ON / ${cyc.offDays} OFF` : "Continuo"}
                      />
                    );
                  })}
                </div>
              </Section>

              <Section title="Acciones">
                <div className="flex flex-col gap-2">
                  <button className="rounded-xl bg-gray-900 px-3 py-2 text-sm font-medium text-white hover:bg-gray-800" onClick={() => markAllForDate(selectedDate)}>
                    Marcar todo (día)
                  </button>
                  <button className="rounded-xl bg-white px-3 py-2 text-sm font-medium text-gray-900 ring-1 ring-gray-200 hover:bg-gray-50" onClick={() => clearDate(selectedDate)}>
                    Limpiar marcas (día)
                  </button>
                  <button className="rounded-xl bg-white px-3 py-2 text-sm font-medium text-gray-900 ring-1 ring-gray-200 hover:bg-gray-50" onClick={() => setSelectedDate(todayIso)}>
                    Ir a hoy
                  </button>
                </div>
              </Section>
            </div>

            <div className="lg:col-span-9 space-y-4">
              {view === "daily" && (
                <Section
                  title={`Checklist del día · ${selectedDate}`}
                  right={
                    <input
                      type="date"
                      className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
                      value={selectedDate}
                      onChange={(e) => setSelectedDate(e.target.value)}
                    />
                  }
                >
                  {(() => {
                    const planned = getPlannedItemsForDate(selectedDate);
                    const takenMap = getTakenMapForDate(selectedDate);
                    const dateObj = parseISODate(selectedDate) || new Date();
                    const c = completionForDate(dateObj);

                    if (!planned.length) {
                      return <div className="text-sm text-gray-600">No hay elementos planificados para este día (o están filtrados).</div>;
                    }

                    const g = new Map();
                    for (const it of planned) {
                      if (!g.has(it.momento)) g.set(it.momento, []);
                      g.get(it.momento).push(it);
                    }

                    return (
                      <div className="space-y-4">
                        <div className="rounded-2xl border border-gray-200 bg-white p-4">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-sm font-semibold text-gray-900">Progreso del día</div>
                              <div className="text-xs text-gray-600">{c.takenCount}/{c.plannedCount} completados</div>
                            </div>
                            <div className="w-40"><Progress value={c.ratio} /></div>
                          </div>
                        </div>

                        {Array.from(g.entries()).map(([momento, items]) => {
                          const done = items.filter((x) => takenMap[x.key]).length;
                          const ratio = items.length ? done / items.length : 0;
                          return (
                            <div key={momento} className="rounded-2xl border border-gray-200 bg-white">
                              <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
                                <div>
                                  <div className="text-sm font-semibold text-gray-900">{momento}</div>
                                  <div className="text-xs text-gray-600">{done}/{items.length} completados</div>
                                </div>
                                <div className="w-32"><Progress value={ratio} /></div>
                              </div>
                              <div className="p-4">
                                <div className="space-y-2">
                                  {items.map((it) => {
                                    const cyc = paramByName.get(it.suplemento);
                                    const st = cyc ? computeStatusForDate(dateObj, cyc) : "";
                                    return (
                                      <label key={it.key} className="flex items-start gap-3 rounded-xl bg-gray-50 p-3">
                                        <input
                                          type="checkbox"
                                          className="mt-1 h-4 w-4 rounded border-gray-300"
                                          checked={!!takenMap[it.key]}
                                          onChange={(e) => setTakenFor(selectedDate, it.key, e.target.checked)}
                                        />
                                        <div className="min-w-0">
                                          <div className="flex flex-wrap items-center gap-2">
                                            <div className="font-medium text-gray-900">{it.suplemento}</div>
                                            {it.dosis ? <Pill status="">{it.dosis}</Pill> : null}
                                            {st ? <Pill status={st}>{st}</Pill> : null}
                                          </div>
                                          {it.notas ? <div className="mt-1 text-xs text-gray-700">{it.notas}</div> : null}
                                          {it.regla ? <div className="mt-1 text-xs text-gray-500">{it.regla}</div> : null}
                                        </div>
                                      </label>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </Section>
              )}

              {view === "weekly" && (
                <Section
                  title="Vista semanal"
                  right={
                    <input
                      type="date"
                      className="rounded-xl border border-gray-300 bg-white px-3 py-2 text-sm"
                      value={selectedDate}
                      onChange={(e) => setSelectedDate(e.target.value)}
                    />
                  }
                >
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {weekDays.map((d) => {
                      const iso = toISODate(d);
                      const c = completionForDate(d);
                      const isToday = iso === todayIso;
                      const isSel = iso === selectedDate;
                      return (
                        <button
                          key={iso}
                          className={`text-left rounded-2xl border bg-white p-4 hover:bg-gray-50 ${isSel ? "border-gray-900 ring-2 ring-gray-100" : "border-gray-200"}`}
                          onClick={() => {
                            setSelectedDate(iso);
                            setView("daily");
                          }}
                        >
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-semibold text-gray-900">{d.toLocaleDateString(undefined, { weekday: "short", day: "2-digit", month: "short" })}</div>
                            {isToday ? <Pill status="">HOY</Pill> : null}
                          </div>
                          <div className="mt-2 text-xs text-gray-600">{c.takenCount}/{c.plannedCount} completados</div>
                          <div className="mt-2"><Progress value={c.ratio} /></div>
                        </button>
                      );
                    })}
                  </div>
                </Section>
              )}

              {view === "monthly" && (
                <Section
                  title="Vista mensual"
                  right={
                    <div className="flex items-center gap-2">
                      <button className="rounded-lg bg-white px-2 py-1 text-sm ring-1 ring-gray-200 hover:bg-gray-50" onClick={() => setMonthCursor((d) => new Date(d.getFullYear(), d.getMonth() - 1, 1))}>←</button>
                      <div className="text-sm font-medium text-gray-900">{monthCursor.toLocaleString(undefined, { month: "long", year: "numeric" })}</div>
                      <button className="rounded-lg bg-white px-2 py-1 text-sm ring-1 ring-gray-200 hover:bg-gray-50" onClick={() => setMonthCursor((d) => new Date(d.getFullYear(), d.getMonth() + 1, 1))}>→</button>
                    </div>
                  }
                >
                  <div className="grid grid-cols-7 gap-2 text-xs font-semibold text-gray-600">
                    {["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((d) => <div key={d} className="px-2">{d}</div>)}
                  </div>
                  <div className="mt-2 grid grid-cols-7 gap-2">
                    {monthGrid.map((d, idx) => {
                      if (!d) return <div key={idx} className="h-24 rounded-xl bg-transparent" />;
                      const iso = toISODate(d);
                      const c = completionForDate(d);
                      const isToday = iso === todayIso;
                      const isSel = iso === selectedDate;
                      return (
                        <button
                          key={iso}
                          className={`h-24 rounded-xl border bg-white p-2 text-left hover:bg-gray-50 ${isSel ? "border-gray-900 ring-2 ring-gray-100" : "border-gray-200"}`}
                          onClick={() => {
                            setSelectedDate(iso);
                            setView("daily");
                          }}
                        >
                          <div className="flex items-center justify-between">
                            <div className="text-sm font-semibold text-gray-900">{d.getDate()}</div>
                            {isToday ? <Pill status="">HOY</Pill> : null}
                          </div>
                          <div className="mt-2 text-xs text-gray-600">{c.takenCount}/{c.plannedCount}</div>
                          <div className="mt-2"><Progress value={c.ratio} /></div>
                        </button>
                      );
                    })}
                  </div>
                </Section>
              )}

              {view === "annual" && (
                <Section
                  title={`Resumen anual · ${monthCursor.getFullYear()}`}
                  right={
                    <div className="flex items-center gap-2">
                      <button className="rounded-lg bg-white px-2 py-1 text-sm ring-1 ring-gray-200 hover:bg-gray-50" onClick={() => setMonthCursor((d) => new Date(d.getFullYear() - 1, d.getMonth(), 1))}>← Año</button>
                      <button className="rounded-lg bg-white px-2 py-1 text-sm ring-1 ring-gray-200 hover:bg-gray-50" onClick={() => setMonthCursor((d) => new Date(d.getFullYear() + 1, d.getMonth(), 1))}>Año →</button>
                    </div>
                  }
                >
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {annualSummary.map((m) => (
                      <button
                        key={m.month.getMonth()}
                        className="rounded-2xl border border-gray-200 bg-white p-4 text-left hover:bg-gray-50"
                        onClick={() => {
                          setMonthCursor(startOfMonth(m.month));
                          setView("monthly");
                        }}
                      >
                        <div className="text-sm font-semibold text-gray-900">{m.month.toLocaleString(undefined, { month: "long" })}</div>
                        <div className="mt-2"><Progress value={m.ratio} /></div>
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 text-xs text-gray-500">El resumen anual calcula el % completado sobre lo planificado (según filtros + ciclos).</div>
                </Section>
              )}

              {view === "routine" && (
                <Section title="Rutina diaria (del Excel)">
                  <div className="space-y-4">
                    {routineGrouped.map(([momento, items]) => (
                      <div key={momento} className="rounded-2xl border border-gray-200 bg-white">
                        <div className="border-b border-gray-100 px-4 py-2">
                          <div className="text-sm font-semibold text-gray-900">{momento}</div>
                        </div>
                        <div className="p-4">
                          <div className="space-y-2">
                            {items.filter((it) => selectedSupp[it.suplemento] !== false).map((it) => (
                              <div key={it.key} className="flex flex-col gap-1 rounded-xl bg-gray-50 p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="font-medium text-gray-900">{it.suplemento}</div>
                                  <div className="text-sm text-gray-700">{it.dosis}</div>
                                </div>
                                {it.regla ? <div className="text-xs text-gray-600">{it.regla}</div> : null}
                                {it.notas ? <div className="text-xs text-gray-700">{it.notas}</div> : null}
                                {paramByName.get(it.suplemento) ? <div className="text-xs text-gray-500">Cíclico</div> : <div className="text-xs text-gray-500">Continuo</div>}
                              </div>
                            ))}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}
            </div>
          </div>
        )}
      </div>

      <Modal open={editOpen} onClose={() => setEditOpen(false)} title="Editar ciclos (Parametros)">
        {!params.length ? (
          <div className="text-sm text-gray-600">No se ha detectado hoja “Parametros”. Sube el Excel del plan anual para editar ciclos.</div>
        ) : (
          <div className="space-y-3">
            <div className="text-sm text-gray-600">Cambia ON/OFF o la pausa inicial. El checklist usa estos ciclos para decidir qué está planificado.</div>
            <div className="overflow-auto rounded-2xl border border-gray-200">
              <table className="min-w-[900px] w-full text-sm">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Suplemento</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Inicio</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">ON (d)</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">OFF (d)</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Pausa (d)</th>
                    <th className="px-3 py-2 text-left font-semibold text-gray-700">Abrev</th>
                  </tr>
                </thead>
                <tbody>
                  {params.map((p) => (
                    <tr key={p.name} className="border-t border-gray-100">
                      <td className="px-3 py-2 text-gray-900">
                        <div className="font-medium">{p.name}</div>
                        {p.notes ? <div className="mt-0.5 text-xs text-gray-500">{p.notes}</div> : null}
                      </td>
                      <td className="px-3 py-2">
                        <input
                          className="w-36 rounded-lg border border-gray-300 bg-white px-2 py-1"
                          value={p.startDate ? toISODate(p.startDate) : ""}
                          onChange={(e) => updateParam(p.name, { startDate: parseISODate(e.target.value) })}
                          placeholder="YYYY-MM-DD"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          className="w-24 rounded-lg border border-gray-300 bg-white px-2 py-1"
                          value={p.onDays}
                          onChange={(e) => updateParam(p.name, { onDays: clamp(Number(e.target.value), 1, 3650) })}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          className="w-24 rounded-lg border border-gray-300 bg-white px-2 py-1"
                          value={p.offDays}
                          onChange={(e) => updateParam(p.name, { offDays: clamp(Number(e.target.value), 0, 3650) })}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          type="number"
                          className="w-24 rounded-lg border border-gray-300 bg-white px-2 py-1"
                          value={p.pauseDays}
                          onChange={(e) => updateParam(p.name, { pauseDays: clamp(Number(e.target.value), 0, 3650) })}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input
                          className="w-20 rounded-lg border border-gray-300 bg-white px-2 py-1"
                          value={p.abrev}
                          onChange={(e) => updateParam(p.name, { abrev: e.target.value })}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="text-xs text-gray-500">Las marcas de “tomado” se conservan aunque edites ciclos.</div>
          </div>
        )}
      </Modal>
    </div>
  );
}

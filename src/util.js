export const MS_DAY = 86400000;

export function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n));
}

export function safeJsonObject(s, fallback) {
  try {
    const v = JSON.parse(s);
    if (v && typeof v === "object") return v;
    return fallback;
  } catch {
    return fallback;
  }
}

export function toISODate(d) {
  const dt = (d instanceof Date) ? d : new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, "0");
  const da = String(dt.getDate()).padStart(2, "0");
  return `${y}-${m}-${da}`;
}

export function parseISODate(iso) {
  if (!iso) return null;
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

export function addDays(d, n) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
}

export function startOfWeekMonday(d) {
  const dt = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const dow = (dt.getDay() + 6) % 7; // Mon=0..Sun=6
  return addDays(dt, -dow);
}

export function isoWeekday(d) {
  // Mon=1..Sun=7
  const x = d.getDay(); // Sun=0..Sat=6
  return x === 0 ? 7 : x;
}

export function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}
export function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

export function canonKey(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // remove accents
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, "-");
}

// -------- Scheduling parsing helpers --------

// Parse weekdays from free text like: "Lun/Mie/Vie", "Mar Jue", "Mon Wed", etc.
// Returns Set of ISO weekdays (1..7) or null if not found.
export function extractWeekdaysFromText(...parts) {
  const txt = parts.map((x) => String(x || "")).join(" ").toLowerCase();

  const map = new Map([
    ["lun", 1], ["lunes", 1], ["mon", 1], ["monday", 1],
    ["mar", 2], ["martes", 2], ["tue", 2], ["tues", 2], ["tuesday", 2],
    ["mie", 3], ["mié", 3], ["mier", 3], ["miércoles", 3], ["weds", 3], ["wed", 3], ["wednesday", 3],
    ["jue", 4], ["jueves", 4], ["thu", 4], ["thurs", 4], ["thursday", 4],
    ["vie", 5], ["viernes", 5], ["fri", 5], ["friday", 5],
    ["sab", 6], ["sáb", 6], ["sábado", 6], ["sat", 6], ["saturday", 6],
    ["dom", 7], ["domingo", 7], ["sun", 7], ["sunday", 7],
  ]);

  // Look for patterns with separators
  const tokens = txt
    .replace(/[.,;()|]+/g, " ")
    .replace(/\//g, " ")
    .split(/\s+/)
    .filter(Boolean);

  const found = new Set();
  for (const t of tokens) {
    if (map.has(t)) found.add(map.get(t));
  }

  return found.size ? found : null;
}

// Parse "cada 2 dias", "cada 2 días", "every 2 days", "every other day"
// Returns integer interval days or null.
export function extractIntervalDaysFromText(...parts) {
  const txt = parts.map((x) => String(x || "")).join(" ").toLowerCase();

  if (txt.includes("every other day")) return 2;
  if (txt.includes("un dia si") && txt.includes("un dia no")) return 2;

  const m1 = txt.match(/cada\s+(\d+)\s+d[ií]as?/);
  if (m1) return Number(m1[1]);

  const m2 = txt.match(/every\s+(\d+)\s+days?/);
  if (m2) return Number(m2[1]);

  const m3 = txt.match(/cada\s+d[ií]a/);
  if (m3) return 1;

  // "cada dos dias"
  if (txt.match(/cada\s+dos\s+d[ií]as?/)) return 2;

  return null;
}

export function parseDoseUnits(doseStr) {
  const s = String(doseStr || "").toLowerCase();

  // number: 1 or 1.5 or 1,5
  const num = (re) => {
    const m = s.match(re);
    if (!m) return null;
    const v = Number(String(m[1]).replace(",", "."));
    return Number.isFinite(v) ? v : null;
  };

  // capsules/tablets
  const caps = num(/(\d+(?:[.,]\d+)?)\s*(c[áa]psula|c[áa]psulas|caps?|tablet|tablets|tab|tabs)\b/);
  if (caps != null) return { qty: caps, unit: "caps" };

  // grams
  const g = num(/(\d+(?:[.,]\d+)?)\s*(g|gr|gramo|gramos|grams)\b/);
  if (g != null) return { qty: g, unit: "g" };

  return { qty: null, unit: null };
}

export function momentRank(m) {
  const x = String(m || "").toLowerCase();
  const list = [
    "al levantar",
    "ayunas",
    "desayuno",
    "media mañana",
    "comida",
    "merienda",
    "cena",
    "antes de dormir",
    "noche",
  ];
  const i = list.findIndex((k) => x.includes(k));
  return i >= 0 ? i : 99;
}

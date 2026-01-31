// src/util.js
export function canonKey(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[®™©]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function normText(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function isoWeekday(d) {
  const js = d.getDay(); // 0=Dom..6=Sáb
  return js === 0 ? 7 : js; // 1=Lun..7=Dom
}

export function extractWeekdaysFromText(...parts) {
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

export function safeJsonObject(s, fallback = {}) {
  if (s === null || s === undefined || s === "") return fallback;
  try {
    const v = JSON.parse(s);
    if (v && typeof v === "object" && !Array.isArray(v)) return v;
    return fallback;
  } catch {
    return fallback;
  }
}

export function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function parseISODate(s) {
  if (!s) return null;
  const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function addDays(d, n) {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function startOfWeekMonday(d) {
  const wd = d.getDay(); // Sun=0
  const delta = wd === 0 ? -6 : 1 - wd;
  const x = new Date(d);
  x.setDate(x.getDate() + delta);
  x.setHours(0, 0, 0, 0);
  return x;
}

export function startOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

export function endOfMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0);
}

export function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

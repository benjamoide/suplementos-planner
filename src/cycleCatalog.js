// Simple catalog of default cycle suggestions (editable in UI).
// mode:
// - none: always ON
// - calendar: ON/OFF depends on dates (fixed rotation)
// - taken: ON-count advances only when you DON'T mark "NO tomado" (extends if you miss)

export function suggestCycleByName(nameRaw) {
  const name = String(nameRaw || "").toLowerCase().trim();

  const has = (...keys) => keys.some((k) => name.includes(k));

  // Keep hierro/cobre fixed by default as requested
  if (has("hierro", "iron")) {
    return { mode: "none", onDays: 0, offDays: 0, pauseDays: 0, label: "Fijo (sin ciclo) por defecto" };
  }
  if (has("cobre", "copper")) {
    return { mode: "none", onDays: 0, offDays: 0, pauseDays: 0, label: "Fijo (sin ciclo) por defecto" };
  }

  // Examples / common cycling templates (you can edit in UI)
  if (has("ashwagandha")) return { mode: "calendar", onDays: 56, offDays: 14, pauseDays: 0, label: "8 semanas ON / 2 semanas OFF" };
  if (has("rhodiola")) return { mode: "calendar", onDays: 42, offDays: 14, pauseDays: 0, label: "6 semanas ON / 2 semanas OFF" };
  if (has("berber")) return { mode: "calendar", onDays: 84, offDays: 14, pauseDays: 0, label: "12 semanas ON / 2 semanas OFF" };
  if (has("phosphatidylserine", "fosfatidilserina")) return { mode: "calendar", onDays: 90, offDays: 30, pauseDays: 0, label: "90 ON / 30 OFF (plantilla)" };
  if (has("uc-ii", "uc ii", "ucii")) return { mode: "none", onDays: 0, offDays: 0, pauseDays: 0, label: "Continuo (plantilla)" };

  // default suggestion (user can change)
  return null;
}

// src/cycleCatalog.js
// Catálogo local (editable) de ciclos sugeridos.
// Nota: no hay un consenso clínico único sobre "ciclar" la mayoría de suplementos.
// Esto es una herramienta de planificación configurable.

import { canonKey } from "./util";

export const CYCLE_TEMPLATES = [
  {
    matchAny: ["ashwagandha", "withania", "shoden"],
    mode: "taken",
    onDays: 56,   // 8 semanas de "tomas efectivas"
    offDays: 14,  // 2 semanas de descanso calendario
    pauseDays: 0,
    label: "Ashwagandha (plantilla)",
  },
  {
    matchAny: ["berberina", "berberine"],
    mode: "taken",
    onDays: 84,   // 12 semanas
    offDays: 28,  // 4 semanas
    pauseDays: 0,
    label: "Berberina (plantilla)",
  },
  {
    matchAny: ["zinc", "picolinato"],
    mode: "taken",
    onDays: 84,   // 12 semanas
    offDays: 28,  // 4 semanas
    pauseDays: 0,
    label: "Zinc (plantilla)",
  },
  {
    matchAny: ["uc ii", "uc-ii", "undenatured collagen", "colageno tipo ii"],
    mode: "calendar",
    onDays: 182,  // ~6 meses
    offDays: 60,  // ~2 meses
    pauseDays: 0,
    label: "UC-II (6 ON / 2 OFF)",
  },
  {
    matchAny: ["r lipoico", "r-lipoico", "r ala", "na r ala", "alpha lipoic", "lipoic"],
    mode: "calendar",
    onDays: 90,   // 3 meses
    offDays: 30,  // 1 mes
    pauseDays: 0,
    label: "R-ALA (3 ON / 1 OFF)",
  },
];

// Devuelve la primera plantilla que encaja por tokens.
// Si no hay match, devuelve null.
export function suggestCycleByName(suppName) {
  const c = canonKey(suppName);
  for (const t of CYCLE_TEMPLATES) {
    if (t.matchAny.some((k) => c.includes(canonKey(k)))) return t;
  }
  return null;
}

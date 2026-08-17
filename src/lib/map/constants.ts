// Club Map — shared constants for the tactical territory map.
//
// Ported from the BSCO intel app's tactical map, reworked for the portal:
// one pin-style dimension (the original's separate category + icon columns
// overlapped confusingly), MC-flavored labels, and normalized u/v coords.
//
// Pin glyph colors are "physical map ink," not brand — same sanctioned
// exception as cut rarity colors (see CutViewer).

export interface MapPinStyle {
  key: string;
  label: string;
  glyph: string; // emoji rendered inside the pin dot
  color: string;
}

export const MAP_PIN_STYLES: MapPinStyle[] = [
  { key: "clubhouse", label: "Clubhouse", glyph: "🏠", color: "#8e44ad" },
  { key: "stash", label: "Stash", glyph: "📦", color: "#16a085" },
  { key: "meet", label: "Meet Spot", glyph: "🤝", color: "#2980b9" },
  { key: "rival", label: "Rival Turf", glyph: "🚩", color: "#c0392b" },
  { key: "cops", label: "Cops", glyph: "🚔", color: "#3d6bb3" },
  { key: "deal", label: "Deal", glyph: "💰", color: "#d4af37" },
  { key: "weapons", label: "Weapons", glyph: "🔫", color: "#d35400" },
  { key: "product", label: "Product", glyph: "💊", color: "#27ae60" },
  { key: "fruit", label: "Fruit Trees", glyph: "🍎", color: "#7cb342" },
  { key: "vehicle", label: "Vehicle", glyph: "🚗", color: "#34495e" },
  { key: "lookout", label: "Lookout", glyph: "👁️", color: "#1abc9c" },
  { key: "danger", label: "Danger", glyph: "⚠️", color: "#e74c3c" },
  { key: "body", label: "Body", glyph: "💀", color: "#7b241c" },
  { key: "target", label: "Target", glyph: "🎯", color: "#c0399b" },
  { key: "run", label: "Run Stop", glyph: "🏁", color: "#7f8c8d" },
];

export const MAP_PIN_KEYS = MAP_PIN_STYLES.map((s) => s.key) as [string, ...string[]];

export function pinStyle(key: string): MapPinStyle {
  return MAP_PIN_STYLES.find((s) => s.key === key) ?? MAP_PIN_STYLES[0];
}

// Turf-zone fill palette (BSCO TERRITORY_PALETTE, unchanged — map ink).
export const TURF_PALETTE = [
  "#c0392b", "#8e44ad", "#2980b9", "#16a085", "#27ae60", "#d35400",
  "#d4af37", "#7f8c8d", "#e74c3c", "#1abc9c", "#e67e22", "#9b59b6",
] as const;

/** Stable auto-color: 31-based rolling hash of the crew name (BSCO scheme). */
export function autoCrewColor(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return TURF_PALETTE[Math.abs(h) % TURF_PALETTE.length];
}

// The shared game-world satellite image. A game asset, not org branding —
// every GTA RP tenant renders the same world (org override can become a
// branding field when a tenant needs it).
export const MAP_IMAGE_PATH = "/maps/gta5-satellite.webp";

/**
 * w/h of the map image. Coordinates are stored as normalized u/v (0..1,
 * u left→right, v top→bottom — the cut-layout convention), so the image
 * file can be swapped for any same-aspect art without moving a single pin.
 */
export const MAP_ASPECT = 2356 / 3200;

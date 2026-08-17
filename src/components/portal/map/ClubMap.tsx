"use client";

// Club Map — interactive territory map (ported from the BSCO intel app's
// Leaflet tactical map, rebuilt for the portal). Renders the game-world
// satellite image as a CRS.Simple Leaflet overlay; pins and turf zones are
// stored as normalized u/v (0..1) and converted to map units at paint time,
// so the artwork can be swapped for any same-aspect image without moving
// a single pin.
//
// Leaflet is imported dynamically inside useEffect — it touches `window`
// at module scope and must never run during SSR.

import "leaflet/dist/leaflet.css";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import type {
  LatLngBoundsExpression,
  LayerGroup,
  LeafletMouseEvent,
  Map as LeafletMap,
} from "leaflet";
import { Flag, MapPin, Search, Undo2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  deleteMapMarker,
  deleteMapTerritory,
  saveMapMarker,
  saveMapTerritory,
} from "@/actions/map";
import {
  autoCrewColor,
  MAP_ASPECT,
  MAP_IMAGE_PATH,
  MAP_PIN_STYLES,
  pinStyle,
  TURF_PALETTE,
} from "@/lib/map/constants";
import type { MapPoint } from "@/lib/types";

type L = typeof import("leaflet");

// Serialized (Timestamp-free) shapes passed from the server page.
export interface ClubMapMarker extends MapPoint {
  id: string;
  label: string;
  style: string;
  description: string;
  droppedBy: string | null; // road name, resolved server-side
}

export interface ClubMapTerritory {
  id: string;
  crewName: string;
  label: string;
  color: string | null;
  points: MapPoint[];
}

// Virtual map space: 1000 units wide, height follows the image aspect.
// u/v (0..1, v top→bottom) ⇄ Leaflet CRS.Simple (lat up from bottom).
const W = 1000;
const H = W / MAP_ASPECT;
const BOUNDS: LatLngBoundsExpression = [
  [0, 0],
  [H, W],
];
const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const toLatLng = (p: MapPoint): [number, number] => [(1 - p.v) * H, p.u * W];
const fromLatLng = (lat: number, lng: number): MapPoint => ({
  u: clamp01(lng / W),
  v: clamp01(1 - lat / H),
});

interface MarkerDraft {
  markerId?: string;
  label: string;
  style: string;
  description: string;
  u: number;
  v: number;
}

interface TerritoryDraft {
  territoryId?: string;
  crewName: string;
  label: string;
  color: string | null;
  points: MapPoint[];
}

export function ClubMap({
  orgId,
  markers,
  territories,
  canEditPins,
  canManage,
  compact = false,
}: {
  orgId: string;
  markers: ClubMapMarker[];
  territories: ClubMapTerritory[];
  canEditPins: boolean;
  canManage: boolean;
  /** Dashboard embed: view-only, no toolbar/search/chips. */
  compact?: boolean;
}) {
  const [isPending, startTransition] = useTransition();

  const containerRef = useRef<HTMLDivElement>(null);
  const leafletRef = useRef<L | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const turfLayerRef = useRef<LayerGroup | null>(null);
  const pinLayerRef = useRef<LayerGroup | null>(null);
  const previewLayerRef = useRef<LayerGroup | null>(null);
  const redrawTargetRef = useRef<ClubMapTerritory | null>(null);

  const [ready, setReady] = useState(false);
  const [query, setQuery] = useState("");
  const [hiddenStyles, setHiddenStyles] = useState<ReadonlySet<string>>(new Set());
  const [placeMode, setPlaceMode] = useState(false);
  const [drawMode, setDrawMode] = useState(false);
  const [drawPoints, setDrawPoints] = useState<MapPoint[]>([]);
  const [markerDraft, setMarkerDraft] = useState<MarkerDraft | null>(null);
  const [territoryDraft, setTerritoryDraft] = useState<TerritoryDraft | null>(null);

  const editable = !compact && canEditPins;

  // ── Filtering (bad rows are skipped so one corrupt doc can't kill the map) ──
  const q = query.trim().toLowerCase();
  const visibleMarkers = useMemo(
    () =>
      markers.filter(
        (m) =>
          Number.isFinite(m.u) &&
          Number.isFinite(m.v) &&
          !hiddenStyles.has(m.style) &&
          (!q ||
            m.label.toLowerCase().includes(q) ||
            m.description.toLowerCase().includes(q) ||
            pinStyle(m.style).label.toLowerCase().includes(q)),
      ),
    [markers, hiddenStyles, q],
  );
  const visibleTerritories = useMemo(
    () =>
      territories.filter(
        (t) =>
          t.points.length >= 3 &&
          t.points.every((p) => Number.isFinite(p.u) && Number.isFinite(p.v)) &&
          (!q ||
            t.crewName.toLowerCase().includes(q) ||
            t.label.toLowerCase().includes(q)),
      ),
    [territories, q],
  );
  const stylesInUse = useMemo(
    () => MAP_PIN_STYLES.filter((s) => markers.some((m) => m.style === s.key)),
    [markers],
  );

  // ── Mode + mutation handlers (declared before the effects that call them) ──
  function togglePlace() {
    redrawTargetRef.current = null;
    setDrawMode(false);
    setDrawPoints([]);
    setPlaceMode((v) => !v);
  }

  function startDraw(redrawOf: ClubMapTerritory | null = null) {
    redrawTargetRef.current = redrawOf;
    setPlaceMode(false);
    setDrawPoints([]);
    setDrawMode(true);
  }

  function cancelDraw() {
    redrawTargetRef.current = null;
    setDrawMode(false);
    setDrawPoints([]);
  }

  function finishDraw() {
    if (drawPoints.length < 3) {
      toast.error("A turf zone needs at least 3 points");
      return;
    }
    const target = redrawTargetRef.current;
    setTerritoryDraft(
      target
        ? {
            territoryId: target.id,
            crewName: target.crewName,
            label: target.label,
            color: target.color,
            points: drawPoints,
          }
        : { crewName: "", label: "", color: null, points: drawPoints },
    );
    cancelDraw();
  }

  /** Confirm + delete. Returns false when the user cancels the confirm. */
  function confirmDeleteMarker(m: { id: string; label: string }): boolean {
    if (!window.confirm(`Delete the pin "${m.label}"?`)) return false;
    startTransition(async () => {
      const result = await deleteMapMarker({ orgId, markerId: m.id });
      if (result.ok) toast.success("Pin deleted");
      else toast.error(result.error ?? "Delete failed");
    });
    return true;
  }

  function confirmDeleteTerritory(t: ClubMapTerritory) {
    if (!window.confirm(`Delete ${t.crewName}'s turf zone?`)) return;
    startTransition(async () => {
      const result = await deleteMapTerritory({ orgId, territoryId: t.id });
      if (result.ok) toast.success("Turf zone deleted");
      else toast.error(result.error ?? "Delete failed");
    });
  }

  // ── Popup DOM (built imperatively; textContent throughout — no injected user HTML) ──
  function markerPopup(m: ClubMapMarker): HTMLElement {
    const style = pinStyle(m.style);
    const root = el("div", "club-popup");
    root.appendChild(el("p", "club-popup-eyebrow", style.label, { color: style.color }));
    root.appendChild(el("p", "club-popup-title", m.label));
    if (m.description) root.appendChild(el("p", "club-popup-body", m.description));
    if (m.droppedBy) root.appendChild(el("p", "club-popup-meta", `Dropped by "${m.droppedBy}"`));
    if (editable || (!compact && canManage)) {
      const row = el("div", "club-popup-actions");
      if (editable) {
        row.appendChild(
          btn("Edit", () => {
            mapRef.current?.closePopup();
            setMarkerDraft({ markerId: m.id, ...m });
          }),
        );
      }
      if (!compact && canManage) {
        row.appendChild(
          btn(
            "Delete",
            () => {
              mapRef.current?.closePopup();
              confirmDeleteMarker(m);
            },
            true,
          ),
        );
      }
      root.appendChild(row);
    }
    return root;
  }

  function territoryPopup(t: ClubMapTerritory): HTMLElement {
    const color = t.color ?? autoCrewColor(t.crewName);
    const root = el("div", "club-popup");
    root.appendChild(el("p", "club-popup-eyebrow", "Turf", { color }));
    root.appendChild(el("p", "club-popup-title", t.crewName));
    if (t.label) root.appendChild(el("p", "club-popup-body", t.label));
    if (!compact && canManage) {
      const row = el("div", "club-popup-actions");
      row.appendChild(
        btn("Edit", () => {
          mapRef.current?.closePopup();
          setTerritoryDraft({ territoryId: t.id, ...t });
        }),
      );
      row.appendChild(
        btn("Redraw", () => {
          mapRef.current?.closePopup();
          startDraw(t);
        }),
      );
      row.appendChild(
        btn(
          "Delete",
          () => {
            mapRef.current?.closePopup();
            confirmDeleteTerritory(t);
          },
          true,
        ),
      );
      root.appendChild(row);
    }
    return root;
  }

  // ── Build the map once ──
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const mod = await import("leaflet");
      const L = (mod.default ?? mod) as L;
      if (cancelled || !containerRef.current || mapRef.current) return;

      const map = L.map(containerRef.current, {
        crs: L.CRS.Simple,
        minZoom: -2,
        maxZoom: 3,
        // Continuous zoom: fitBounds lands on the EXACT scale where the island
        // fills the stage. Any snap > 0 rounds down and shrinks the artwork
        // (0.25-snap left it at half size in a typical viewport).
        zoomSnap: 0,
        zoomDelta: 0.5,
        attributionControl: false,
        maxBounds: BOUNDS,
        maxBoundsViscosity: 0.8,
      });
      L.imageOverlay(MAP_IMAGE_PATH, BOUNDS).addTo(map);
      map.fitBounds(BOUNDS);
      map.setMinZoom(map.getZoom() - 0.5);

      // Zones under pins under the draw preview.
      turfLayerRef.current = L.layerGroup().addTo(map);
      pinLayerRef.current = L.layerGroup().addTo(map);
      previewLayerRef.current = L.layerGroup().addTo(map);

      leafletRef.current = L;
      mapRef.current = map;
      setReady(true);
    })();

    const container = containerRef.current;
    const observer = new ResizeObserver(() => mapRef.current?.invalidateSize());
    if (container) observer.observe(container);

    return () => {
      cancelled = true;
      observer.disconnect();
      mapRef.current?.remove();
      mapRef.current = null;
      setReady(false);
    };
  }, []);

  // ── Map clicks: place a pin or add a draw vertex (rebound as modes change) ──
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    const onClick = (e: LeafletMouseEvent) => {
      const p = fromLatLng(e.latlng.lat, e.latlng.lng);
      if (drawMode) {
        setDrawPoints((pts) => [...pts, p]);
      } else if (placeMode) {
        setPlaceMode(false);
        setMarkerDraft({ label: "", style: "clubhouse", description: "", ...p });
      }
    };
    map.on("click", onClick);
    // Double-clicking while aiming a vertex/pin must not zoom the map (and a
    // double-click would otherwise also register two stray vertices' clicks).
    if (placeMode || drawMode) map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();
    return () => {
      map.off("click", onClick);
    };
  }, [ready, placeMode, drawMode]);

  // ── Paint pins ──
  useEffect(() => {
    const L = leafletRef.current;
    const layer = pinLayerRef.current;
    if (!ready || !L || !layer) return;
    layer.clearLayers();

    for (const m of visibleMarkers) {
      const style = pinStyle(m.style);
      const icon = L.divIcon({
        className: "club-pin",
        iconSize: [26, 26],
        iconAnchor: [13, 13],
        popupAnchor: [0, -14],
        html: `<span class="club-pin-dot" style="background:${style.color}">${style.glyph}</span>`,
      });
      // Like the turf polygons below: pins must not swallow clicks while the
      // user is placing a pin or tracing a boundary — Leaflet markers don't
      // bubble clicks to the map.
      // Pins are NEVER draggable: a placed pin is club intel, and a stray drag
      // on a touchpad silently rewrites where the crew thinks a spot is. The
      // only way to move one is delete + re-drop, which is deliberate and
      // audited.
      const marker = L.marker(toLatLng(m), {
        icon,
        interactive: !(placeMode || drawMode),
        title: m.label,
      });
      marker.bindPopup(() => markerPopup(m));
      marker.addTo(layer);
    }
    // Repaint only when data/filters/permissions/modes change, not on every
    // render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, visibleMarkers, editable, compact, canManage, placeMode, drawMode]);

  // ── Paint turf zones ──
  useEffect(() => {
    const L = leafletRef.current;
    const layer = turfLayerRef.current;
    if (!ready || !L || !layer) return;
    layer.clearLayers();

    for (const t of visibleTerritories) {
      const color = t.color ?? autoCrewColor(t.crewName);
      const polygon = L.polygon(t.points.map(toLatLng), {
        color,
        weight: 2,
        fillOpacity: 0.18,
        // Clicks fall through to the map while placing or drawing.
        interactive: !placeMode && !drawMode,
      });
      polygon.on("mouseover", () => polygon.setStyle({ fillOpacity: 0.35 }));
      polygon.on("mouseout", () => polygon.setStyle({ fillOpacity: 0.18 }));
      // Tooltip content MUST be a DOM node: Leaflet assigns string content via
      // innerHTML, which would turn a user-authored crew name into stored XSS.
      polygon.bindTooltip(el("span", "", t.crewName.toUpperCase()), {
        permanent: true,
        direction: "center",
        className: "turf-label",
      });
      polygon.bindPopup(() => territoryPopup(t));
      polygon.addTo(layer);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, visibleTerritories, placeMode, drawMode, compact, canManage]);

  // ── Paint draw preview ──
  useEffect(() => {
    const L = leafletRef.current;
    const layer = previewLayerRef.current;
    if (!ready || !L || !layer) return;
    layer.clearLayers();
    if (!drawMode || drawPoints.length === 0) return;

    if (drawPoints.length >= 2) {
      L.polygon(drawPoints.map(toLatLng), {
        color: "#00e5ff",
        weight: 2,
        dashArray: "5",
        fillOpacity: 0.08,
        interactive: false,
      }).addTo(layer);
    }
    for (const p of drawPoints) {
      L.circleMarker(toLatLng(p), {
        radius: 4,
        color: "#ffffff",
        weight: 1,
        fillColor: "#00e5ff",
        fillOpacity: 1,
        interactive: false,
      }).addTo(layer);
    }
  }, [ready, drawMode, drawPoints]);

  // ── Zoom-to-fit on search ──
  useEffect(() => {
    const L = leafletRef.current;
    const map = mapRef.current;
    if (!ready || !L || !map) return;
    if (!q) {
      map.fitBounds(BOUNDS);
      return;
    }
    const pts = [
      ...visibleMarkers.map(toLatLng),
      ...visibleTerritories.flatMap((t) => t.points.map(toLatLng)),
    ];
    if (pts.length > 0) {
      map.fitBounds(L.latLngBounds(pts), { padding: [50, 50], maxZoom: 1.5 });
    }
    // Refit only when the query itself changes, not on unrelated repaints.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, q]);

  // ── Crosshair cursor while placing/drawing ──
  const crosshair = placeMode || drawMode;
  useEffect(() => {
    const stage = containerRef.current;
    if (stage) stage.style.cursor = crosshair ? "crosshair" : "";
  }, [crosshair]);

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      {!compact && (
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-52 flex-1 sm:max-w-xs">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search pins and turf…"
              aria-label="Search the map"
              className="pl-8 pr-8"
            />
            {query && (
              <button
                type="button"
                onClick={() => setQuery("")}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            )}
          </div>

          {canEditPins && !drawMode && (
            <Button
              type="button"
              variant={placeMode ? "destructive" : "default"}
              onClick={togglePlace}
              disabled={isPending}
            >
              <MapPin className="size-4" aria-hidden />
              {placeMode ? "Cancel placement" : "Drop pin"}
            </Button>
          )}

          {canManage && !placeMode && !drawMode && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => startDraw()}
              disabled={isPending}
            >
              <Flag className="size-4" aria-hidden />
              Draw turf
            </Button>
          )}
          {drawMode && (
            <>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setDrawPoints((pts) => pts.slice(0, -1))}
                disabled={drawPoints.length === 0}
              >
                <Undo2 className="size-4" aria-hidden />
                Undo point
              </Button>
              <Button type="button" onClick={finishDraw} disabled={drawPoints.length < 3}>
                Finish zone ({drawPoints.length})
              </Button>
              <Button type="button" variant="destructive" onClick={cancelDraw}>
                Cancel
              </Button>
            </>
          )}

          {(placeMode || drawMode) && (
            <p className="w-full text-xs font-medium uppercase tracking-[0.14em] text-primary">
              {placeMode
                ? "Click the map to place the pin"
                : "Click to add points, then finish (min 3)"}
            </p>
          )}
        </div>
      )}

      {/* Map stage. `isolate` opens a new stacking context so Leaflet's
          z-index-400 panes can't paint over body-level overlays (the pin
          dialog is z-50 — without isolation the map covers it). Non-compact:
          the stage matches the island artwork's portrait aspect and is
          centered, sized to fill the viewport height — no dead letterbox
          bands left and right of the image. */}
      <div
        className={
          compact
            ? "isolate overflow-hidden rounded-lg border border-border"
            : "isolate mx-auto w-full overflow-hidden rounded-lg border border-border"
        }
        style={
          compact
            ? undefined
            : { maxWidth: `min(100%, calc(78vh * ${MAP_ASPECT}))` }
        }
      >
        <div
          ref={containerRef}
          role="application"
          aria-label="Club territory map"
          className={compact ? "h-80 w-full bg-background" : "w-full bg-background"}
          style={compact ? undefined : { aspectRatio: String(MAP_ASPECT) }}
        />
      </div>

      {/* Style chips: legend + filter in one */}
      {!compact && stylesInUse.length > 0 && (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Filter pins by type">
          {stylesInUse.map((s) => {
            const hidden = hiddenStyles.has(s.key);
            return (
              <button
                key={s.key}
                type="button"
                aria-pressed={!hidden}
                onClick={() =>
                  setHiddenStyles((prev) => {
                    const next = new Set(prev);
                    if (next.has(s.key)) next.delete(s.key);
                    else next.add(s.key);
                    return next;
                  })
                }
                className={`glass glass-hover flex min-h-8 items-center gap-1.5 rounded-full px-3 text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
                  hidden ? "opacity-40" : ""
                }`}
              >
                <span
                  className="inline-block size-2.5 rounded-full"
                  style={{ background: s.color }}
                  aria-hidden
                />
                {s.glyph} {s.label}
              </button>
            );
          })}
        </div>
      )}

      {/* Pin editor — keyed so each new draft mounts with fresh form state */}
      {markerDraft && (
        <MarkerDialog
          key={markerDraft.markerId ?? `new:${markerDraft.u}:${markerDraft.v}`}
          orgId={orgId}
          draft={markerDraft}
          onClose={() => setMarkerDraft(null)}
          canManage={!compact && canManage}
          onDelete={(m) => {
            // Confirm FIRST — cancelling must return to the dialog with the
            // user's in-progress edits intact.
            if (confirmDeleteMarker(m)) setMarkerDraft(null);
          }}
        />
      )}

      {/* Turf editor */}
      {territoryDraft && (
        <TerritoryDialog
          key={territoryDraft.territoryId ?? `new:${territoryDraft.points.length}`}
          orgId={orgId}
          draft={territoryDraft}
          onSaved={() => setTerritoryDraft(null)}
          onDismiss={(draft) => {
            // Esc/overlay/X must not throw away a traced boundary — put the
            // vertices back into draw mode so the officer can finish or cancel
            // deliberately.
            setTerritoryDraft(null);
            redrawTargetRef.current = draft.territoryId
              ? {
                  id: draft.territoryId,
                  crewName: draft.crewName,
                  label: draft.label,
                  color: draft.color,
                  points: draft.points,
                }
              : null;
            setPlaceMode(false);
            setDrawPoints(draft.points);
            setDrawMode(true);
          }}
        />
      )}

      {/* Leaflet skin: dark-theme popups/tooltips via brand CSS vars. */}
      <style>{`
        .club-pin { background: transparent; border: 0; }
        .club-pin-dot {
          display: flex; align-items: center; justify-content: center;
          width: 26px; height: 26px; border-radius: 9999px;
          border: 2px solid rgba(255,255,255,0.85);
          font-size: 13px; line-height: 1;
          box-shadow: 0 2px 8px rgba(0,0,0,0.55);
        }
        .turf-label {
          background: transparent; border: 0; box-shadow: none;
          color: rgba(255,255,255,0.92);
          font-size: 11px; font-weight: 700; letter-spacing: 0.12em;
          text-shadow: 0 1px 4px rgba(0,0,0,0.9);
        }
        .leaflet-container { background: var(--background); font: inherit; }
        .leaflet-popup-content-wrapper, .leaflet-popup-tip {
          background: var(--card); color: var(--card-foreground);
          box-shadow: 0 8px 24px rgba(0,0,0,0.5);
        }
        .leaflet-popup-content { margin: 12px 14px; }
        .club-popup { min-width: 10rem; max-width: 14rem; }
        .club-popup-eyebrow { font-size: 0.6rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.14em; }
        .club-popup-title { margin-top: 2px; font-weight: 600; }
        .club-popup-body { margin-top: 4px; font-size: 0.8rem; opacity: 0.85; overflow-wrap: anywhere; }
        .club-popup-meta { margin-top: 6px; font-size: 0.7rem; opacity: 0.6; }
        .club-popup-actions { display: flex; gap: 6px; margin-top: 8px; }
        /* Glass idiom by hand: these are plain-DOM buttons inside Leaflet's
           popup pane, where backdrop-filter is banned (the compositor would
           re-sample the map on every pan frame), so the frost is painted
           with gradients only, mirroring the .glass utility's recipe. Danger
           stays SOLID, same deliberate tier as the Button destructive
           variant: a delete must never glow prettier than a save. */
        .club-popup-btn {
          min-height: 28px; padding: 0 10px; border-radius: 6px; cursor: pointer;
          font-size: 0.7rem; font-weight: 600; text-transform: uppercase; letter-spacing: 0.08em;
          color: var(--secondary-foreground);
          border: 1px solid color-mix(in srgb, var(--foreground) 14%, transparent);
          background: linear-gradient(
            180deg,
            color-mix(in srgb, var(--foreground) 10%, transparent),
            color-mix(in srgb, var(--foreground) 3%, transparent) 46%,
            color-mix(in srgb, var(--background) 32%, transparent)
          );
          box-shadow:
            inset 0 1px 0 color-mix(in srgb, var(--foreground) 16%, transparent),
            inset 0 -1px 0 rgb(0 0 0 / 0.35);
          transition: transform 0.18s ease, border-color 0.28s ease, box-shadow 0.28s ease;
        }
        @media (hover: hover) {
          .club-popup-btn:hover {
            transform: translateY(-1px);
            border-color: color-mix(in srgb, var(--primary) 55%, transparent);
            box-shadow:
              inset 0 1px 0 color-mix(in srgb, var(--foreground) 22%, transparent),
              0 0 14px -4px color-mix(in srgb, var(--primary) 38%, transparent);
          }
        }
        .club-popup-btn:active { transform: translateY(1px); box-shadow: inset 0 2px 6px rgb(0 0 0 / 0.55); }
        .club-popup-btn:focus-visible { outline: 2px solid var(--ring); outline-offset: 2px; }
        .club-popup-btn.danger {
          background: var(--destructive); color: #fff; border-color: transparent;
          box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.14);
        }
        @media (hover: hover) {
          .club-popup-btn.danger:hover {
            /* No lift, no ember edge: solid darken only (Button parity). */
            transform: none;
            border-color: transparent;
            background: color-mix(in srgb, var(--destructive) 90%, transparent);
            box-shadow: inset 0 1px 0 rgb(255 255 255 / 0.14);
          }
        }
      `}</style>
    </div>
  );
}

// ── Small DOM helpers for popup content (textContent only — XSS-safe) ──
function el(
  tag: string,
  className: string,
  text?: string,
  style?: Partial<CSSStyleDeclaration>,
): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text;
  if (style) Object.assign(node.style, style);
  return node;
}

function btn(label: string, onClick: () => void, danger = false): HTMLButtonElement {
  const node = document.createElement("button");
  node.type = "button";
  node.className = danger ? "club-popup-btn danger" : "club-popup-btn";
  node.textContent = label;
  node.addEventListener("click", onClick);
  return node;
}

// ── Pin editor dialog (mounted per-draft via key, so state inits from props) ──
function MarkerDialog({
  orgId,
  draft,
  onClose,
  canManage,
  onDelete,
}: {
  orgId: string;
  draft: MarkerDraft;
  onClose: () => void;
  canManage: boolean;
  onDelete: (m: { id: string; label: string }) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [label, setLabel] = useState(draft.label);
  const [style, setStyle] = useState(draft.style);
  const [description, setDescription] = useState(draft.description);

  function submit() {
    startTransition(async () => {
      const result = await saveMapMarker({
        orgId,
        markerId: draft.markerId,
        label,
        style,
        description: description.trim() ? description.trim() : undefined,
        u: draft.u,
        v: draft.v,
      });
      if (result.ok) {
        toast.success(draft.markerId ? "Pin updated" : "Pin dropped");
        onClose();
      } else {
        toast.error(result.error ?? "Could not save the pin");
      }
    });
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{draft.markerId ? "Edit pin" : "Drop a pin"}</DialogTitle>
          <DialogDescription>Intel pins are visible to the whole club.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="pin-label">Label</Label>
            <Input
              id="pin-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={80}
              placeholder="e.g. Rival hangout, Grapeseed"
            />
          </div>
          <div className="space-y-2">
            <Label>Pin style</Label>
            <div
              className="grid grid-cols-3 gap-1.5 sm:grid-cols-4"
              role="group"
              aria-label="Pin style"
            >
              {/* glass-card, not glass: fifteen tiles in one grid, and a
                  backdrop-filter apiece buys nothing inside an already-blurred
                  dialog (perf rule in globals.css). Selected = ember tint under
                  the same glass gradient. */}
              {MAP_PIN_STYLES.map((s) => (
                <button
                  key={s.key}
                  type="button"
                  aria-pressed={style === s.key}
                  onClick={() => setStyle(s.key)}
                  className={`glass-card glass-hover flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-md px-1 py-1.5 text-[0.65rem] outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
                    style === s.key
                      ? "border-primary bg-primary/10 text-foreground"
                      : "text-muted-foreground"
                  }`}
                >
                  <span aria-hidden>{s.glyph}</span>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="pin-desc">Notes (optional)</Label>
            <Textarea
              id="pin-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={1000}
              rows={3}
              placeholder="What does the club need to know about this spot?"
            />
          </div>
        </div>
        <DialogFooter className="gap-2 sm:justify-between">
          {draft.markerId && canManage ? (
            <Button
              type="button"
              variant="destructive"
              disabled={isPending}
              onClick={() => onDelete({ id: draft.markerId!, label })}
            >
              Delete
            </Button>
          ) : (
            <span />
          )}
          <Button type="button" onClick={submit} disabled={isPending || !label.trim()}>
            {isPending ? "Saving…" : draft.markerId ? "Save changes" : "Drop pin"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── Turf editor dialog ──
function TerritoryDialog({
  orgId,
  draft,
  onSaved,
  onDismiss,
}: {
  orgId: string;
  draft: TerritoryDraft;
  onSaved: () => void;
  onDismiss: (draft: TerritoryDraft) => void;
}) {
  const [isPending, startTransition] = useTransition();
  const [crewName, setCrewName] = useState(draft.crewName);
  const [label, setLabel] = useState(draft.label);
  const [color, setColor] = useState<string | null>(draft.color);

  function submit() {
    startTransition(async () => {
      const result = await saveMapTerritory({
        orgId,
        territoryId: draft.territoryId,
        crewName,
        label: label.trim() ? label.trim() : undefined,
        color,
        points: draft.points,
      });
      if (result.ok) {
        toast.success(draft.territoryId ? "Turf updated" : "Turf claimed");
        onSaved();
      } else {
        toast.error(result.error ?? "Could not save the turf zone");
      }
    });
  }

  const preview = crewName.trim() ? (color ?? autoCrewColor(crewName.trim())) : null;

  return (
    <Dialog open onOpenChange={(open) => !open && onDismiss(draft)}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{draft.territoryId ? "Edit turf zone" : "Claim turf"}</DialogTitle>
          <DialogDescription>{draft.points.length} boundary points</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="turf-crew">Crew</Label>
            <Input
              id="turf-crew"
              value={crewName}
              onChange={(e) => setCrewName(e.target.value)}
              maxLength={60}
              // Rival crews only, and none of them the club's own: the field
              // is for whose turf this is, and naming yourself here is never
              // the answer.
              placeholder="e.g. Lost MC, Vagos, Ballas"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="turf-label">Zone name (optional)</Label>
            <Input
              id="turf-label"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={80}
              placeholder="e.g. North docks turf"
            />
          </div>
          <div className="space-y-2">
            <Label>Zone color</Label>
            <div
              className="flex flex-wrap items-center gap-1.5"
              role="group"
              aria-label="Zone color"
            >
              <button
                type="button"
                aria-pressed={color === null}
                onClick={() => setColor(null)}
                className={`glass-card glass-hover flex min-h-8 items-center rounded-full px-3 text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
                  color === null
                    ? "border-primary bg-primary/10 text-foreground"
                    : "text-muted-foreground"
                }`}
              >
                Auto
              </button>
              {/* The inline ink color wins over glass-card's gradient — the
                  swatch keeps its palette color and only inherits the glass
                  edge/sheen. Selected ring stays border-foreground, not
                  border-primary: half the palette is ember-adjacent and a
                  primary ring would vanish on it. */}
              {TURF_PALETTE.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={color === c}
                  aria-label={`Color ${c}`}
                  onClick={() => setColor(c)}
                  className={`glass-card glass-hover size-8 rounded-full border-2 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 ${
                    color === c ? "border-foreground" : "border-transparent"
                  }`}
                  style={{ background: c }}
                />
              ))}
              {preview && (
                <span className="ml-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span
                    className="inline-block size-3 rounded-full"
                    style={{ background: preview }}
                    aria-hidden
                  />
                  in use
                </span>
              )}
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" onClick={submit} disabled={isPending || !crewName.trim()}>
            {isPending ? "Saving…" : draft.territoryId ? "Save changes" : "Claim turf"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

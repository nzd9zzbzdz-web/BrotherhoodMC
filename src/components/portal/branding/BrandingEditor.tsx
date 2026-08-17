"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import {
  Download,
  Loader2,
  RotateCcw,
  Save,
  Undo2,
  Upload,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { resetBranding, saveBranding } from "@/actions/branding";
import {
  BRANDING_ART,
  BRANDING_ART_GROUPS,
  BRANDING_ART_KEYS,
} from "@/lib/branding-art";
import {
  SHARED_IDENTITY_KEYS,
  draftToResolved,
  toDraft,
  type BrandingDraft,
  type ResolvedBranding,
} from "@/lib/branding-resolve";
import { brandingPresetSchema } from "@/lib/schemas/branding";
import type { BrandingAssetKey, BrandingColors } from "@/lib/types";
import { AssetCard } from "./AssetCard";
import { BrandingPreview } from "./BrandingPreview";
import { ColorField } from "./ColorField";
import { PlateLayoutEditor } from "./PlateLayoutEditor";
import { WatermarkEditor } from "./WatermarkEditor";
import { EmblemStyleEditor } from "./EmblemStyleEditor";

type Surface = "public" | "portal";
type ColorKey = keyof Required<BrandingColors>;

/**
 * The colour form, grouped by what each token DOES rather than by its shadcn
 * name. This table is the difference between a theme editor and a list of
 * twenty hex fields: an admin picking a club colour needs to know that
 * `primary` is what paints the active nav item, not that it is slot 5 of the
 * design system.
 *
 * `over` names the token a translucent value is composited against, so the
 * swatch for a `rgba(...)` border shows what that border actually looks like
 * on the surface it is drawn on.
 */
const COLOR_SECTIONS: {
  title: string;
  blurb: string;
  fields: { key: ColorKey; label: string; hint?: string; over: ColorKey }[];
}[] = [
  {
    title: "Brand",
    blurb:
      "The colours that say whose club this is. Primary is spent on STATE: the active nav item, hover and focus, officer standing, numbers that matter, and alerts. Structure (card borders, dividers, headings) takes a neutral.",
    fields: [
      {
        key: "primary",
        label: "Primary brand colour",
        hint: "Active nav, primary buttons, officer standing, key numbers.",
        over: "background",
      },
      {
        key: "secondary",
        label: "Secondary",
        hint: "Supporting fills and quieter chips.",
        over: "background",
      },
      {
        key: "accent",
        label: "Accent",
        hint: "Deeper supporting tone, used in gradients and glass.",
        over: "background",
      },
      {
        key: "glow",
        label: "Glow / highlight",
        hint: "The bloom under buttons and the halo on focus.",
        over: "background",
      },
      {
        key: "destructive",
        label: "Danger",
        hint: "Delete and remove. Kept solid on purpose.",
        over: "background",
      },
    ],
  },
  {
    title: "Surfaces",
    blurb: "The grounds everything else is painted on, darkest to lightest.",
    fields: [
      { key: "background", label: "Page background", over: "background" },
      {
        key: "sidebar",
        label: "Sidebar background",
        hint: "Set it darker than the page and the rail reads as recessed.",
        over: "background",
      },
      { key: "card", label: "Card / panel background", over: "background" },
      {
        key: "elevated",
        label: "Elevated surface",
        hint: "One step above a card: popovers, hovered rows.",
        over: "background",
      },
      { key: "muted", label: "Muted fill", over: "background" },
    ],
  },
  {
    title: "Text",
    blurb: "Contrast lives here. Keep body text well clear of its ground.",
    fields: [
      { key: "foreground", label: "Primary text", over: "background" },
      { key: "mutedForeground", label: "Muted text", over: "background" },
      { key: "cardForeground", label: "Text on cards", over: "card" },
      { key: "primaryForeground", label: "Text on primary", over: "primary" },
      { key: "secondaryForeground", label: "Text on secondary", over: "secondary" },
      { key: "accentForeground", label: "Text on accent", over: "accent" },
    ],
  },
  {
    title: "Lines",
    blurb:
      "Borders, rules and focus. A translucent value is fine here, and often better than a solid.",
    fields: [
      { key: "border", label: "Border colour", over: "card" },
      { key: "sidebarBorder", label: "Sidebar border", over: "sidebar" },
      { key: "input", label: "Input border", over: "card" },
      { key: "ring", label: "Focus ring", over: "card" },
    ],
  },
];

const SURFACE_COPY: Record<Surface, { label: string; blurb: string }> = {
  portal: {
    label: "Portal",
    blurb: "The clubhouse behind the login: what members see every day.",
  },
  public: {
    label: "Public site",
    blurb: "The shopfront: the home page, About, Gallery and Contact.",
  },
};

/**
 * Admin → Branding: the whole visual identity of the site in one place.
 *
 * Draft-first. Nothing here writes on keystroke — colours, names and taglines
 * are held locally and painted into the preview, and only Save commits them.
 * Image uploads are the exception and stage their own preview per card (an
 * image is a file, not a form field, and holding megabytes of unsaved binary
 * across four tabs is a different problem than holding a hex string).
 *
 * The two surfaces are edited separately because they genuinely differ: the
 * portal draws its structural lines in weathered bone while the shopfront
 * keeps crimson, and the club's public name is not always its real one.
 */
export function BrandingEditor({
  orgId,
  orgSlug,
  initial,
  assetUrls,
  customAssetKeys,
}: {
  orgId: string;
  /** Selects this club's preset, so the preview and Reset mean THIS club. */
  orgSlug: string;
  initial: Record<Surface, ResolvedBranding>;
  /** The URL each slot currently resolves to, on the surface that owns it. */
  assetUrls: Record<BrandingAssetKey, string>;
  /** Slots running on an upload rather than the shipped default. */
  customAssetKeys: BrandingAssetKey[];
}) {
  const saved = useMemo(
    () => ({ portal: toDraft(initial.portal), public: toDraft(initial.public) }),
    [initial],
  );

  const [surface, setSurface] = useState<Surface>("portal");
  const [drafts, setDrafts] = useState<Record<Surface, BrandingDraft>>(saved);
  const [renameOrg, setRenameOrg] = useState(true);
  const [pending, startTransition] = useTransition();
  const importRef = useRef<HTMLInputElement>(null);

  const draft = drafts[surface];
  const custom = useMemo(() => new Set(customAssetKeys), [customAssetKeys]);

  // Compared as JSON rather than field by field: the draft is a flat bag of
  // strings, so this is both exact and immune to a new field being added
  // without the dirty check being told about it.
  const dirty = useMemo(
    () => JSON.stringify(drafts[surface]) !== JSON.stringify(saved[surface]),
    [drafts, saved, surface],
  );

  const preview = useMemo(
    () => draftToResolved(draft, surface, initial[surface].assets, { slug: orgSlug, name: draft.orgDisplayName }),
    [draft, surface, initial, orgSlug],
  );

  /**
   * Edit one surface's draft. Anything in SHARED_IDENTITY_KEYS lands on BOTH
   * drafts, matching what `saveBranding` writes: the club has one set of
   * initials and one clubhouse address, and half of those fields are only
   * drawn on the public site, so a portal-only edit would look like nothing
   * happened. Keeping the drafts in step here is also what stops the other
   * tab from reading as "unsaved" the moment this one is saved.
   */
  function patchSurface(target: Surface, next: Partial<BrandingDraft>) {
    const shared = Object.fromEntries(
      SHARED_IDENTITY_KEYS.filter((k) => k in next).map((k) => [k, next[k]]),
    ) as Partial<BrandingDraft>;
    setDrafts((prev) => ({
      portal: {
        ...prev.portal,
        ...(target === "portal" ? next : {}),
        ...shared,
      },
      public: {
        ...prev.public,
        ...(target === "public" ? next : {}),
        ...shared,
      },
    }));
  }

  function patchColor(target: Surface, key: ColorKey, value: string) {
    setDrafts((prev) => ({
      ...prev,
      [target]: { ...prev[target], colors: { ...prev[target].colors, [key]: value } },
    }));
  }

  function handleSave() {
    startTransition(async () => {
      const result = await saveBranding({ orgId, surface, draft, renameOrg });
      if (result.ok) toast.success(`${SURFACE_COPY[surface].label} branding saved`);
      else toast.error(result.error ?? "Could not save branding");
    });
  }

  function handleCancel() {
    setDrafts((prev) => ({ ...prev, [surface]: saved[surface] }));
    toast.info("Changes discarded");
  }

  function handleReset() {
    const ok = window.confirm(
      `Reset the ${SURFACE_COPY[surface].label.toLowerCase()} colours and identity to the platform defaults?\n\nUploaded images are NOT touched; each image has its own reset. This cannot be undone.`,
    );
    if (!ok) return;
    startTransition(async () => {
      const result = await resetBranding({ orgId, surface });
      if (result.ok) toast.success("Back to the platform defaults");
      else toast.error(result.error ?? "Could not reset branding");
    });
  }

  /**
   * Export both surfaces as one small JSON file. Colours and copy only: images
   * are megabytes and already have their own upload, so a preset stays
   * something you can paste into a chat or commit next to the code.
   */
  function handleExport() {
    const preset = {
      version: 1 as const,
      name: draft.orgDisplayName,
      portal: drafts.portal,
      public: drafts.public,
    };
    const blob = new Blob([JSON.stringify(preset, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slugify(draft.orgDisplayName)}-branding.json`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("Branding preset downloaded");
  }

  async function handleImport(file: File | undefined) {
    if (!file) return;
    try {
      const parsed = brandingPresetSchema.safeParse(JSON.parse(await file.text()));
      if (!parsed.success) {
        toast.error("That file is not a branding preset");
        return;
      }
      // Loaded into the DRAFT, not saved: an import is a proposal, and the
      // admin gets to look at the preview before it reaches the club.
      setDrafts((prev) => ({
        portal: { ...prev.portal, ...parsed.data.portal, colors: { ...prev.portal.colors, ...parsed.data.portal?.colors } },
        public: { ...prev.public, ...parsed.data.public, colors: { ...prev.public.colors, ...parsed.data.public?.colors } },
      }));
      toast.success("Preset loaded. Review the preview, then save each surface.");
    } catch {
      toast.error("Could not read that file");
    } finally {
      if (importRef.current) importRef.current.value = "";
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={handleExport}>
          <Download className="size-4" aria-hidden />
          Export preset
        </Button>
        <Button variant="outline" size="sm" onClick={() => importRef.current?.click()}>
          <Upload className="size-4" aria-hidden />
          Import preset
        </Button>
        <input
          ref={importRef}
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={(e) => handleImport(e.target.files?.[0])}
        />
      </div>

      <Tabs value={surface} onValueChange={(v) => setSurface(v as Surface)}>
        <TabsList>
          <TabsTrigger value="portal">Portal</TabsTrigger>
          <TabsTrigger value="public">Public site</TabsTrigger>
        </TabsList>

        {(["portal", "public"] as Surface[]).map((s) => {
          // Bound to THIS panel's surface rather than to the active one. Radix
          // unmounts the inactive panel so the two are the same today, but a
          // field wired to `surface` instead of `s` is a trap waiting for the
          // day that changes.
          const d = drafts[s];
          const patch = (next: Partial<BrandingDraft>) => patchSurface(s, next);
          const shared = `Shared with the ${s === "portal" ? "public site" : "portal"}.`;
          return (
          <TabsContent key={s} value={s} className="mt-6 space-y-6">
            <p className="text-sm text-muted-foreground">{SURFACE_COPY[s].blurb}</p>

            <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
              <div className="space-y-6">
                {/* ── Club identity ── */}
                <Card>
                  <CardHeader>
                    <CardTitle>Club identity</CardTitle>
                  </CardHeader>
                  <CardContent className="grid gap-4 sm:grid-cols-2">
                    <Field
                      label="Club name"
                      hint={
                        s === "public"
                          ? "How the club presents itself publicly."
                          : "What members see inside the portal."
                      }
                      value={d.orgDisplayName}
                      onChange={(v) => patch({ orgDisplayName: v })}
                    />
                    <Field
                      label="Short name"
                      hint={`Initials for tight spots. Blank falls back to the club name's initials. ${shared}`}
                      value={d.shortName}
                      onChange={(v) => patch({ shortName: v })}
                    />
                    <Field
                      label="Chapter / location"
                      hint={`The bottom rocker's territory. Runs in the public footer. ${shared}`}
                      value={d.location}
                      onChange={(v) => patch({ location: v })}
                    />
                    <Field
                      label="Clubhouse address"
                      hint={`The line above the location in the public footer. Blank hides it. ${shared}`}
                      value={d.addressLine}
                      onChange={(v) => patch({ addressLine: v })}
                    />
                    <Field
                      label="Tagline"
                      hint={
                        s === "public"
                          ? "The creed line under the home page headline."
                          : "Sits under the club name in the nav rail."
                      }
                      value={d.tagline}
                      onChange={(v) => patch({ tagline: v })}
                    />
                    <div className="sm:col-span-2">
                      <Label className="text-xs font-medium">Mission</Label>
                      <Textarea
                        value={d.mission}
                        rows={3}
                        onChange={(e) => patch({ mission: e.target.value })}
                        className="mt-1.5"
                      />
                      <p className="mt-1 text-[0.7rem] text-muted-foreground">
                        The standfirst on the home page and About page.
                      </p>
                    </div>
                    <Field
                      label="Club anthem"
                      hint={`YouTube video id for the floating player. Blank uses the shipped track. ${shared}`}
                      value={d.anthemVideoId}
                      onChange={(v) => patch({ anthemVideoId: v })}
                    />
                    <label className="flex items-start gap-2.5 self-end pb-1 text-xs text-muted-foreground">
                      <Checkbox
                        checked={renameOrg}
                        onCheckedChange={(v) => setRenameOrg(v === true)}
                        className="mt-0.5"
                      />
                      <span>
                        Rename the organization record too, so the club name matches
                        everywhere. Leave this off to change only what this surface
                        displays.
                      </span>
                    </label>
                  </CardContent>
                </Card>

                {/* ── Chain of command ──
                    Portal only: the plate is drawn on the Brotherhood page
                    behind the login, and the fields are written to the portal
                    document alone. The plate ART is an asset card below. */}
                {s === "portal" && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Chain of command</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        The heading and line on the Brotherhood page, whether it
                        runs as the engraved plate or as the plain panel. The
                        plate artwork itself is swapped under Brand assets.
                      </p>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <Field
                          label="Heading"
                          hint="Engraved top left of the plate. Blank goes back to the default."
                          value={d.chainTitle}
                          onChange={(v) => patch({ chainTitle: v })}
                        />
                        <Field
                          label="Blurb"
                          hint="The line under the heading. Blank hides it."
                          value={d.chainBlurb}
                          onChange={(v) => patch({ chainBlurb: v })}
                        />
                      </div>
                      {/* Only with plate art on the wall: the boxes are placed
                          ON a picture, and with no picture there is nothing to
                          register them against (and nothing renders them). */}
                      {assetUrls.plateArt ? (
                        <PlateLayoutEditor
                          art={assetUrls.plateArt}
                          title={d.chainTitle || "Brotherhood"}
                          blurb={d.chainBlurb}
                          value={d.plateLayout}
                          onChange={(v) => patch({ plateLayout: v })}
                        />
                      ) : (
                        <p className="text-[0.7rem] leading-snug text-muted-foreground">
                          Upload plate artwork under Brand assets and you can
                          drag the heading, seats and counts into place on it
                          here.
                        </p>
                      )}
                    </CardContent>
                  </Card>
                )}

                {/* ── Home page watermark ──
                    Public only: the treatment is drawn on the home page's
                    pillars band, and the field is written to the public
                    document alone. The watermark ART is an asset card below. */}
                {s === "public" && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Home page watermark</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        The oversized illustration behind the four pillars on
                        the home page. Drag it into place and tune its size,
                        glow and colour here; the artwork itself is swapped
                        under Brand assets.
                      </p>
                      <WatermarkEditor
                        art={assetUrls.watermark}
                        background={d.colors.background}
                        value={d.watermarkStyle}
                        onChange={(v) => patch({ watermarkStyle: v })}
                      />
                    </CardContent>
                  </Card>
                )}

                {/* ── Emblem treatment ──
                    Public only, same contract as the watermark: drawn on the
                    home page pillars and the About page rule, written to the
                    public document alone. The emblem ART is four asset cards
                    below. */}
                {s === "public" && (
                  <Card>
                    <CardHeader>
                      <CardTitle>Emblem treatment</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        The four badges above the home page pillars and between
                        the About page acts. Tune their size, colour and
                        strength as a set here; each badge&apos;s artwork is
                        swapped under Brand assets.
                      </p>
                      <EmblemStyleEditor
                        arts={[
                          assetUrls.emblemOne,
                          assetUrls.emblemTwo,
                          assetUrls.emblemThree,
                          assetUrls.emblemFour,
                        ]}
                        background={d.colors.background}
                        value={d.emblemStyle}
                        onChange={(v) => patch({ emblemStyle: v })}
                      />
                    </CardContent>
                  </Card>
                )}

                {/* ── Colour theme ── */}
                {COLOR_SECTIONS.map((section) => (
                  <Card key={section.title}>
                    <CardHeader>
                      <CardTitle>{section.title}</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        {section.blurb}
                      </p>
                      <div className="grid gap-4 sm:grid-cols-2">
                        {section.fields.map((field) => (
                          <ColorField
                            key={field.key}
                            label={field.label}
                            hint={field.hint}
                            value={d.colors[field.key]}
                            over={d.colors[field.over]}
                            onChange={(v) => patchColor(s, field.key, v)}
                          />
                        ))}
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>

              {/* ── Live preview ── */}
              <div className="xl:sticky xl:top-6 xl:self-start">
                <h2 className="mb-2 text-sm font-semibold text-foreground">
                  Live preview
                </h2>
                <p className="mb-3 text-xs text-muted-foreground">
                  Painted from the same token map the real site uses, so what you
                  see here is what saving produces.
                </p>
                <BrandingPreview branding={preview} />
              </div>
            </div>
          </TabsContent>
          );
        })}
      </Tabs>

      {/* ── Brand assets ──────────────────────────────────────────────
          Not inside the surface tabs: several slots (the patch, the member
          silhouette) are drawn on both faces, and an admin looking for "the
          club logo" should not have to guess which tab it is filed under. */}
      <section className="space-y-6">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Brand assets</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Every image the site uses to say whose club it is. Uploads are cropped
            or padded to the slot, converted to webp, and served straight away.
            PNG transparency is preserved wherever a slot calls for a cut-out.
          </p>
        </div>

        {BRANDING_ART_GROUPS.map((group) => {
          const keys = BRANDING_ART_KEYS.filter((k) => BRANDING_ART[k].group === group);
          if (!keys.length) return null;
          return (
            <div key={group} className="space-y-3">
              <h3 className="text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                {group}
              </h3>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {keys.map((key) => (
                  <AssetCard
                    key={key}
                    orgId={orgId}
                    artKey={key}
                    spec={BRANDING_ART[key]}
                    currentUrl={assetUrls[key]}
                    isCustom={custom.has(key)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </section>

      {/* ── Action bar ──────────────────────────────────────────────
          Sticky at the bottom of the viewport: the colour form is long enough
          that a Save button at its end would be off screen for most of the
          time an admin spends here. */}
      <div className="sticky bottom-0 -mx-2 border-t border-border bg-background/95 px-2 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={pending || !dirty} onClick={handleSave}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Save className="size-4" aria-hidden />
            )}
            Save {SURFACE_COPY[surface].label.toLowerCase()} branding
          </Button>
          <Button variant="outline" disabled={pending || !dirty} onClick={handleCancel}>
            <Undo2 className="size-4" aria-hidden />
            Cancel changes
          </Button>
          <Button variant="ghost" disabled={pending} onClick={handleReset}>
            <RotateCcw className="size-4" aria-hidden />
            Reset to default
          </Button>
          <p className="text-xs text-muted-foreground">
            {dirty
              ? "Unsaved changes on this surface."
              : "Everything on this surface is saved."}
          </p>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string;
  onChange: (next: string) => void;
}) {
  return (
    <div>
      <Label className="text-xs font-medium">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} className="mt-1.5" />
      {hint && <p className="mt-1 text-[0.7rem] leading-snug text-muted-foreground">{hint}</p>}
    </div>
  );
}

function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "club"
  );
}

"use client";

import type { CSSProperties } from "react";
import { Bike, Flame, Home, Shield, Users } from "lucide-react";
import { brandingVars } from "@/lib/branding-css";
import type { ResolvedBranding } from "@/lib/branding-resolve";

/**
 * How the club will look, painted from the unsaved draft.
 *
 * The whole panel is one element carrying the branding variables as inline
 * styles, produced by the SAME `brandingVars` the live site is painted with.
 * That is what makes this a preview rather than an impression: there is no
 * second copy of the mapping to fall out of step, so if a token is wired up
 * here it is wired up on the site.
 *
 * It deliberately shows the pieces that carry the club's identity rather than
 * a screenshot of any one page: the rail, an active nav item, a heading in the
 * display face, the primary button, a member card, a bordered panel, muted
 * copy, and the club patch.
 */
export function BrandingPreview({ branding }: { branding: ResolvedBranding }) {
  return (
    <div
      // `dark` because both club surfaces are dark rooms; without it the
      // preview would inherit the admin page's own token layer for anything
      // the branding map does not set.
      className="dark overflow-hidden rounded-xl border"
      style={
        {
          ...brandingVars(branding),
          borderColor: "var(--border-primary)",
          background: "var(--background-main)",
          color: "var(--text-primary)",
          fontFamily: "var(--font-body)",
        } as CSSProperties
      }
    >
      <div className="flex min-h-[22rem]">
        {/* ── Nav rail ── */}
        <nav
          aria-hidden
          className="hidden w-44 shrink-0 flex-col gap-1 border-r p-3 sm:flex"
          style={{
            background: "var(--background-sidebar)",
            borderRightColor: "var(--sidebar-border)",
          }}
        >
          <p
            className="mb-2 truncate px-2 text-sm"
            style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}
          >
            {branding.shortName}
          </p>
          {[
            { icon: Home, label: "Dashboard", active: true },
            { icon: Users, label: "Brotherhood", active: false },
            { icon: Bike, label: "Activities", active: false },
            { icon: Shield, label: "My Cut", active: false },
          ].map((item) => (
            <span
              key={item.label}
              className="flex items-center gap-2 rounded-md px-2 py-1.5 text-xs font-medium"
              style={
                item.active
                  ? {
                      // Active nav is a STATE, which is what the accent is
                      // spent on. Same rule as the live rail.
                      background: "color-mix(in srgb, var(--brand-primary) 16%, transparent)",
                      color: "var(--brand-primary)",
                      boxShadow: "inset 2px 0 0 var(--brand-primary)",
                    }
                  : { color: "var(--text-muted)" }
              }
            >
              <item.icon className="size-3.5" aria-hidden />
              {item.label}
            </span>
          ))}
        </nav>

        {/* ── Page ── */}
        <div className="min-w-0 flex-1 space-y-4 p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="min-w-0">
              <h3
                className="truncate text-2xl"
                style={{ fontFamily: "var(--font-display)", color: "var(--text-primary)" }}
              >
                {branding.name}
              </h3>
              <p
                className="mt-0.5 truncate text-xs uppercase tracking-[0.16em]"
                style={{ color: "var(--text-muted)" }}
              >
                {branding.tagline || branding.location || " "}
              </p>
            </div>
            {/* eslint-disable-next-line @next/next/no-img-element -- served art or static file */}
            <img
              src={branding.assets.clubPatch}
              alt=""
              aria-hidden
              className="h-14 w-auto shrink-0 object-contain"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <span
              className="rounded-md px-3 py-1.5 text-xs font-semibold"
              style={{
                background: "var(--brand-primary)",
                color: "var(--brand-on-primary)",
                boxShadow:
                  "0 0 22px -6px color-mix(in srgb, var(--brand-glow) 80%, transparent)",
              }}
            >
              Log a Run
            </span>
            <span
              className="rounded-md border px-3 py-1.5 text-xs font-semibold"
              style={{
                borderColor: "var(--border-strong)",
                color: "var(--text-primary)",
              }}
            >
              Secondary
            </span>
            <span
              className="rounded-md px-3 py-1.5 text-xs font-semibold"
              style={{
                background: "var(--destructive)",
                color: "var(--brand-on-primary)",
              }}
            >
              Remove
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-[9rem_1fr]">
            {/* Member card — the roster's basic unit. */}
            <div
              className="relative overflow-hidden rounded-lg border"
              style={{
                aspectRatio: "3 / 4",
                borderColor: "var(--border-primary)",
                background: "var(--background-panel)",
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- served art or static file */}
              <img
                src={
                  branding.surface === "portal"
                    ? branding.assets.portalRosterBackdrop
                    : branding.assets.rosterBackdrop
                }
                alt=""
                aria-hidden
                className="absolute inset-0 size-full object-cover opacity-60"
              />
              {/* eslint-disable-next-line @next/next/no-img-element -- served art or static file */}
              <img
                src={branding.assets.defaultAvatar}
                alt=""
                aria-hidden
                className="absolute inset-x-0 bottom-0 mx-auto h-[86%] w-auto object-contain"
              />
              <div
                className="absolute inset-x-0 bottom-0 p-2"
                style={{
                  background:
                    "linear-gradient(to top, var(--background-main), transparent)",
                }}
              >
                <p className="text-[0.7rem] font-semibold" style={{ color: "var(--text-primary)" }}>
                  Reaper
                </p>
                <p className="text-[0.6rem]" style={{ color: "var(--brand-primary)" }}>
                  President
                </p>
              </div>
            </div>

            {/* Panel — the portal's standard bordered surface. */}
            <div
              className="space-y-2 rounded-lg border p-4"
              style={{
                borderColor: "var(--border-primary)",
                background: "var(--background-panel)",
              }}
            >
              <div className="flex items-center gap-2">
                <Flame className="size-4" style={{ color: "var(--brand-primary)" }} aria-hidden />
                <span className="text-sm font-semibold" style={{ color: "var(--text-primary)" }}>
                  Patches earned
                </span>
                <span
                  className="ml-auto text-lg font-semibold"
                  style={{ color: "var(--brand-primary)", fontFamily: "var(--font-stat)" }}
                >
                  14
                </span>
              </div>
              <p className="text-xs leading-relaxed" style={{ color: "var(--text-muted)" }}>
                Muted body copy, the way it reads across the club: notes, blurbs,
                and everything under a heading.
              </p>
              <div
                className="h-px"
                style={{ background: "var(--border-subtle)" }}
                aria-hidden
              />
              <div
                className="rounded-md p-2 text-xs"
                style={{
                  background: "var(--background-elevated)",
                  color: "var(--text-secondary)",
                }}
              >
                A raised surface: popovers, hovered rows, the character screen
                plates.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

---
version: "alpha"
name: "Drifter 2077 Operations"
description: "Cyberpunk-noir operations dashboard tokens for the auto_YT suite, applied to web, web_2, and web_3."
colors:
  primary: "#26D9FF"
  background: "#0B1016"
  background-raised: "#121923"
  surface: "#18212C"
  surface-muted: "#253140"
  surface-subtle: "#101821"
  border: "#344254"
  border-subtle: "rgba(170, 195, 226, 0.09)"
  text-primary: "#F7FAFF"
  text-secondary: "#C3CEDB"
  text-muted: "#95A3B5"
  accent: "#26D9FF"
  accent-hover: "#12BFE8"
  accent-soft: "rgba(38, 217, 255, 0.14)"
  success: "#43D17A"
  success-soft: "rgba(67, 209, 122, 0.14)"
  warning: "#FFB020"
  warning-soft: "rgba(255, 176, 32, 0.14)"
  danger: "#FF5C7A"
  danger-soft: "rgba(255, 92, 122, 0.14)"
  assembly: "#A78BFA"
  assembly-soft: "rgba(167, 139, 250, 0.16)"
typography:
  page-title:
    fontFamily: "system-ui, -apple-system, SF Pro Text, sans-serif"
    fontSize: "28px"
    fontWeight: 650
    lineHeight: 1.14
    letterSpacing: "0px"
  section-label:
    fontFamily: "system-ui, -apple-system, SF Pro Text, sans-serif"
    fontSize: "11px"
    fontWeight: 650
    lineHeight: 1.2
    letterSpacing: "0.04em"
  body:
    fontFamily: "system-ui, -apple-system, SF Pro Text, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "0px"
  metadata:
    fontFamily: "system-ui, -apple-system, SF Pro Text, sans-serif"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.35
    letterSpacing: "0px"
  mono:
    fontFamily: "var(--font-geist-mono), ui-monospace, SFMono-Regular, Menlo, monospace"
    fontSize: "12px"
    fontWeight: 500
    lineHeight: 1.45
    letterSpacing: "0px"
rounded:
  sm: "4px"
  md: "8px"
  lg: "10px"
  xl: "12px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "24px"
  xxl: "32px"
components:
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.lg}"
    padding: "16px"
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.background}"
    rounded: "{rounded.md}"
    height: "28px"
    padding: "10px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.md}"
  status-badge:
    backgroundColor: "{colors.surface-muted}"
    textColor: "{colors.text-secondary}"
    rounded: "{rounded.sm}"
    height: "20px"
  table-row:
    backgroundColor: "transparent"
    textColor: "{colors.text-primary}"
    padding: "12px"
---

## Overview

Drifter 2077 is a dense operations dashboard for a cyberpunk-noir media pipeline.
It should feel technical, nocturnal, and precise: a production console for long-form
ambient video work, not a marketing site. Prefer compact surfaces, scan-friendly
rows, clear status color, and restrained motion.

## Colors

The palette uses near-black foundations, blue-gray surfaces, and one cyan action
accent. Success, warning, danger, and assembly tones are reserved for pipeline state.
Avoid decorative gradients and single-hue washes; the UI should read as operational.

## Typography

Use system sans for all dashboard UI and the configured mono face for identifiers,
job stages, timestamps, prompts, and code-like text. Keep letter spacing at zero
except uppercase section labels, which use modest tracking for fast scanning.

## Layout

Use compact spacing and stable row heights. Dashboard pages should remain centered
in the existing max-width container. Cards are for grouped tools and repeated items;
do not nest cards inside cards.

## Elevation & Depth

Use borders and subtle contrast rather than heavy shadows. Backdrop blur is allowed
only for the fixed top navigation.

## Shapes

Use small radii. Cards and panels use 10-12px; inputs and buttons use 8px; small
status pills use 4-8px.

## Components

Primary actions use cyan. Destructive actions use danger. Retry/waiting controls
use warning. Pipeline statuses must use semantic status tokens, not ad hoc colors.

## Do's and Don'ts

- Do keep workflows dense, readable, and predictable.
- Do use semantic tokens from this file for new UI.
- Don't introduce new hardcoded hex colors inside dashboard components.
- Don't add landing-page hero treatments or decorative backgrounds to operations pages.

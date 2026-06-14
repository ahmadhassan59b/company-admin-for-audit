# ResortLux Design System

## Overview

ResortLux is a premium, serene design system centered on full-bleed imagery, crafted for luxury resort and boutique hotel websites. Its refined palette of gold, navy, and ivory channels the elegance of high-end hospitality.

## Status

This design system was used earlier for the prototype. The current UI theme is now defined in `HUBSPOT_INSPIRED_DESIGN_SYSTEM.md` and implemented in `ui-static/styles.css`.

## Source

- DesignMD chef page: `https://designmd.ai/chef/resortlux`

Note: There is no DesignMD MCP connector available in this environment, so the implementation below is based on the ResortLux MD you provided plus the published URL as a reference pointer.

## Colors

- **Primary Gold** (`#BF9452`): Primary actions, accent lines
- **Secondary Navy** (`#0F172A`): Headers, strong text
- **Tertiary Ivory** (`#FFFFF0`): Backgrounds, subtle fills
- **Background** (`#FFFFF0`): Page background
- **Surface Default** (`#FFFFFF`): Card backgrounds
- **Success** (`#15803D`)
- **Warning** (`#CA8A04`)
- **Error** (`#DC2626`)
- **Info** (`#0369A1`)

## Typography

- Display: `Playfair Display` (headers, score/value emphasis)
- Body/UI: `Inter` (forms, labels, tables, secondary copy)
- Case: avoid aggressive all-caps for long text; keep it for small UI labels only (eyebrows, chips)

## Layout + Surfaces

- Background: ivory (`#FFFFF0`) for calm negative space
- Surfaces: white cards/panels with thin navy line (`rgba(15,23,42,.12)`)
- Corners: 8px radius baseline, pills at 999px
- Shadow: one soft elevated shadow (`0 24px 70px rgba(15,23,42,.12)`)
- Content width: `min(1160px, 100vw - 40px)` for desktop scanning without feeling cramped

## Imagery

- Use full-bleed imagery with navy overlay for headers and auth screens
- Prefer real resort/hospitality photography: bright, detailed, not overly dark or abstract
- Overlay pattern: navy gradient (higher opacity at top, softer at bottom) to keep text readable

## Do's and Don'ts

- Do use full-bleed imagery prominently
- Don't overcrowd pages - less is more
- Do ensure all booking CTAs are Gold for immediate recognition

## Implementation (This Repo)

Core tokens + components:

- Tokens: `--gold`, `--navy`, `--ivory`, `--surface`, `--radius`, `--line`, `--shadow`
- Buttons: `.primaryButton` (gold), `.secondaryButton` (outline), `.linkButton` (inline)
- Containers: `.shell`, `.panel`, `.actions`
- Report UI: `.metrics`, `.metric`, `.issueList`, `.issue`, `.severity`
- Hero: `.heroBand` / `.heroInner` / `.heroMeta` / `.heroPill`

Where it is implemented:

- Static UI theme: `ui-static/styles.css`
- Static UI pages: `ui-static/*.html`
- Static UI server: `scripts/ui-server.js` (serves UI on `:3001`)

Notes:

- The `frontend/` Next.js app exists but is not used in the current local run because Next's dev/build worker relies on `child_process.fork()` which fails in this environment.

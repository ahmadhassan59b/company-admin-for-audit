# Claude Editorial Redesign

This document captures the warm, editorial visual direction now being applied to HubAudit.

## Goal

Move the app away from cool gray/blue SaaS styling and toward a warmer, more literary interface inspired by Claude.com:

- tinted cream canvas instead of pure white
- muted coral as the signature brand accent
- dark navy product surfaces for code / AI / loading / modal chrome
- serif display headlines paired with a clean sans body
- minimal shadows, more color-blocked surface contrast

## Core Tokens

- Canvas: `#faf9f5`
- Surface card: `#efe9de`
- Surface soft: `#f5f0e8`
- Surface strong: `#e8e0d2`
- Dark surface: `#181715`
- Dark elevated: `#252320`
- Dark soft: `#1f1e1b`
- Primary coral: `#cc785c`
- Primary active: `#a9583e`
- Primary disabled: `#e6dfd8`
- Ink: `#141413`
- Muted text: `#6c6a64`

## Typography

- Display: `Cormorant Garamond` / `Tiempos Headline` style serif
- Body: `Inter`
- Mono: `JetBrains Mono`
- Display headings stay weight 400 with tight negative tracking

## Component Direction

- Hero and major banners should feel editorial and spacious
- Primary CTAs use coral
- Secondary containers use warm cream cards
- AI/code/loading surfaces use dark navy panels
- Search, pills, tables, and cards should inherit the warm palette

## Implementation Notes

- The shared stylesheet is the source of truth for the visual system.
- Avoid introducing new cool accents; keep the palette within cream, coral, amber, teal, and navy.
- Any hidden UI preferences should remain functional, but the visible style should follow this system.

## Current Status

Implementation has started in `ui-static/styles.css` and will continue by cleaning any remaining legacy blue/red color tokens across the shared UI.

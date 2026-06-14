# HubSpot-Inspired Design System (For This App)

## Goal

Make the UI feel like a modern SaaS product: bright, simple, lots of whitespace, clear hierarchy, orange as the primary action accent, and predictable navigation.

Note: This is "HubSpot-inspired" styling. We do not copy HubSpot's logo or exact page content.

## Colors

- Primary Accent (Orange): `#FF6C4A`
- Primary Text: `#111827`
- Secondary Text: `#6B7280`
- Border: `#E5E7EB`
- Background: `#F8FAFC`
- Surface: `#FFFFFF`
- Success: `#16A34A`
- Warning: `#F59E0B`
- Error: `#DC2626`

## Typography

- UI + Body: `Inter`, fallback to system sans
- Headings: same family, slightly heavier weight (no serif)

## Layout

- Top navigation on every authenticated page
- Content width: `min(1120px, 100vw - 40px)`
- Cards: 10px radius, light shadow
- Buttons: orange primary, gray secondary, visible hover states

## Components

- `.topNav`, `.brand`, `.navLinks`, `.navActions`
- Brand mark: `ui-static/logo-mark.svg` and `.brandWord` lockup
- `.card`, `.cardHeader`
- `.btnPrimary`, `.btnSecondary`, `.btnLink`
- `.statGrid` + `.statCard`
- `.table` for issue lists

## Pages

- `/login`: centered auth card, minimal background
- `/dashboard`: connection + run audit + history
- `/audit/:id`: score + stats + issues table

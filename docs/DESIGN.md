# Hoja Seeds — Design Reference

## Concept
Grounded in the seed-packet as an object: kraft paper, colour-coded plant
families, stamped typography. Avoids the generic "AI site" look (cream +
terracotta, or dark + neon accent) in favour of an earthy, warm palette
specific to a seed shop.

## Colour tokens (css/styles.css `:root`)
| Token | Hex | Use |
|---|---|---|
| `--soil` | `#2B2118` | Header, hero, dark sections |
| `--soil-light` | `#3D3025` | Hero gradient partner |
| `--kraft` | `#F1E6D0` | Cards, product table background |
| `--kraft-dark` | `#E4D4B4` | Table headers, borders |
| `--leaf` | `#3F6B3F` | Primary actions, vegetable accent |
| `--marigold` | `#D68C2E` | CTAs, highlights |
| `--chili` | `#B84A3E` | Remove/destructive actions, mix accent |
| `--ink` | `#1F2A1C` | Body text |
| `--paper` | `#FBF6EB` | Page background |

## Type
- **Fraunces** (serif) — headings, logo, journey-bar numerals. Stamped
  seed-packet-label feel.
- **Inter** (sans) — body copy, nav, buttons.
- **IBM Plex Mono** — prices, quantities, order IDs. Gives the ledger/receipt
  feel appropriate to a checkout flow.

## Components
- **Sticky bottom bar** — the primary mobile CTA. Context-aware label +
  action (View Cart → Continue to Delivery → Confirm Delivery → Confirm &
  Place Order). Height fixed at `--sticky-h` (64px); `body.has-sticky-bar`
  adds matching bottom padding so content never sits underneath it.
- **Journey bar** — 4 numbered steps (Summary/Delivery/Payment/Confirmed),
  done/active states in leaf/marigold. Paired with a `flow-status` chip row
  showing "Delivery: Pending/Confirmed ✓ · Payment: Pending/Confirmed ✓".
- **Badges** — small pills next to a product name: `★ Premium` (amber) and
  `100% Advance` (chili-tinted) for customized collections. Deliberately
  minimal — not every product needs one.
- **Commerce info bar** — reuses the `.trust-chip` component from the hero,
  shown at the top of category pages (COD availability, free-delivery
  threshold, advance-payment savings).
- **Free-delivery progress** — a one-line message + slim progress track,
  shown only while paying in advance, live-updates as the payment method or
  cart total changes.

## Layout principle
Mobile-first: every rule in `css/styles.css` targets the ~380px viewport by
default; `@media (min-width: 640px/860px)` rules only ever *add* space or
columns, never restructure content order. This matches the stated ~95%
mobile / 5% desktop traffic split.

## Restraint
One visual idea per screen — the seed-packet colour system on category
tabs, the ledger-style mono numerals in tables, the sticky bar as the one
piece of "chrome" that follows the user everywhere. Everything else (cards,
forms, buttons) stays quiet: consistent radius (`--radius: 14px`), one
shadow depth (`--shadow` / `--shadow-sm`), no decorative animation beyond
functional transitions (button press, drawer/bar slide, progress bar fill).

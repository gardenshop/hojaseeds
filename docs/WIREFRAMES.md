# Hoja Seeds — Wireframes

Text wireframes (mobile-first, ~380px width — the layout ~95% of traffic
sees). Desktop simply adds columns/whitespace at wider breakpoints; the
content and order never changes.

## Home
```
┌──────────────────────────────┐
│ ☰   🌱 Hoja Seeds        🧺2 │  <- sticky header
├──────────────────────────────┤
│  🌱 Hoja Seeds                │
│  Good seeds, delivered        │  <- hero, dark gradient
│  to your door.                │
│  [Shop Vegetable Seeds]       │
│  [Browse Mix Kits]            │
│  🚚 Nationwide  💵 COD  🌱... │  <- trust chips
├──────────────────────────────┤
│ [Vegetables] [Flowers]        │  <- 2x2 category tiles,
│ [Mix Kits]   [Fertilizer]     │     photo-ready, gradient fallback
├──────────────────────────────┤
│ Why Hoja Seeds                │
│ [Fresh][Flexible pay]         │
│ [Nationwide][Every garden]    │
└──────────────────────────────┘
```

## Category page (Vegetable/Flower/Mix/Fertilizer)
```
┌──────────────────────────────┐
│ Vegetable Seeds                │
│ Grow your own kitchen garden   │
│ 💵 COD Available  🚚 Free @1500│  <- commerce info bar
├──────────────────────────────┤
│ 🍅 Tomato (Hybrid Roma) ★Prem │
│    per packet      Rs.180     │
│    [-] 0 [+]           —      │
├──────────────────────────────┤
│ 🌿 Okra (Bhindi)               │
│    per packet       Rs.120    │
│    [-] 2 [+]        Rs.240    │
├──────────────────────────────┤
│           ... more rows ...    │
└──────────────────────────────┘
[ 2 items · Rs.240      View Cart → ]  <- sticky bottom bar
```
Tapping +/- writes straight to the cart — no separate "Add" step.

## Order Summary (checkout step 1)
```
┌──────────────────────────────┐
│  ① ── ② ── ③ ── ④             │  <- journey bar (Summary active)
│ Order Summary                 │
├──────────────────────────────┤
│ VEGETABLE SEEDS                │  <- category group label
│ 🌿 Okra          [-]2[+]  🗑️  │
│    Subtotal: Rs.240            │
│ MIX SEEDS                      │
│ ✨ Build-Your-Own [-]1[+] 🗑️  │
│    100% Advance                │  <- badge
│    Subtotal: Rs.1999           │
├──────────────────────────────┤
│ Subtotal            Rs.2239   │
├──────────────────────────────┤
│ [← Continue Shopping] [Continue to Delivery →]
└──────────────────────────────┘
[ 2 items · Rs.2239   Continue to Delivery → ]
```

## Delivery (checkout step 2)
```
┌──────────────────────────────┐
│  ① ── ② ── ③ ── ④             │  <- step 2 active
│ Delivery: Pending  Payment: Pending
│ ← Back to Summary              │
│ Delivery Details                │
│ [Full name] [Phone]            │
│ [Address                    ]  │
│ [City] [Postal (optional)]     │
│ [Notes (optional)          ]   │
│ [    Confirm Delivery      ]   │  <- gated; won't advance until valid
└──────────────────────────────┘
[ 2 items · Rs.2239     Confirm Delivery ]  <- sticky bar mirrors the form
```

## Payment (checkout step 3)
```
┌──────────────────────────────┐
│  ① ── ② ── ③ ── ④             │
│ Delivery: Confirmed ✓  Payment: Pending
│ ← Back to Delivery              │
│ Payment                         │
│ ⚠ Customized orders require    │  <- shown only if cart has a
│   100% advance payment.        │     customized-collection item
│ (•) Advance Payment             │  <- COD hidden in that case
│     JazzCash/EasyPaisa/Bank ·  │
│     Delivery Rs.100 (free @1500)│
│ Rs.320 more for FREE delivery  │  <- live progress message
│ ▓▓▓▓▓▓░░░░░░░░░░ 60%           │
│ [Paid via: JazzCash ▾]         │
│ [Transaction ID            ]   │
│ [ Confirm & Place Order — Rs.2339 ]
├──────────────────────────────┤
│ Order summary                  │
│ Okra x2            Rs.240     │
│ Build-Your-Own x1   Rs.1999   │
│ Delivery             Rs.100   │
│ Total                Rs.2339  │
└──────────────────────────────┘
```

## Confirmation (checkout step 4)
```
┌──────────────────────────────┐
│  ① ── ② ── ③ ── ④  (all done) │
│ Delivery: Confirmed ✓  Payment: Confirmed ✓
│ Thanks, Ali — your order is in!│
│ Order ID: HOJA-M9X2-A1B2       │
│ Items: Okra x2, Build-Your-... │
│ Payment: Advance — JazzCash    │
│ Transaction ref: TXN123456     │
│ Delivery fee: Rs.100           │
│ Total due: Rs.2339             │
│ [    Continue Shopping     ]   │
└──────────────────────────────┘
```

## Super Admin
```
┌──────────────────────────────┐
│ 🌱 Hoja Seeds — Super Admin    │
│ [Password] [Sign in]           │
├──────────────────────────────┤
│ Store Settings                 │
│ [COD fee: 250] [Advance: 100]  │
│ [Free delivery @: 1500]        │
│ [x] COD allowed storewide      │
│ [x] Customized = 100% advance  │  <- enforced, not editable
│ [   Save store settings    ]   │
├──────────────────────────────┤
│ Product prices & types         │
│ VEGETABLE SEEDS                 │
│ 🍅 Tomato   Rs.180 [180] [Premium ▾]
│ 🌿 Okra     Rs.120 [120] [Regular ▾]
│           ... more rows ...    │
│ [   Save product changes   ]   │
└──────────────────────────────┘
```

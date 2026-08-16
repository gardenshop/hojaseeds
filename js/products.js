// Default product catalog. Prices here are FALLBACK defaults only —
// the real source of truth is Super Admin (see js/admin.js + Apps Script sheet).
//
// `type` drives the commercial rules layer (see js/app.js Settings/pricing):
//   "regular"                — individual seeds, everyday price band
//   "premium"                — individual seeds, higher price band, gets a "★ Premium" badge
//   "standard-collection"    — pre-made kits; COD + Advance both available
//   "customized-collection"  — made-to-order kits; 100% advance only, no COD
const DEFAULT_PRODUCTS = [
  // --- Vegetable Seeds ---
  { id: "veg-01", cat: "vegetables", name: "Tomato (Hybrid Roma)", unit: "packet", icon: "🍅", price: 180, type: "premium" },
  { id: "veg-02", cat: "vegetables", name: "Okra (Bhindi)", unit: "packet", icon: "🌿", price: 120, type: "regular" },
  { id: "veg-03", cat: "vegetables", name: "Spinach (Palak)", unit: "packet", icon: "🥬", price: 90, type: "regular" },
  { id: "veg-04", cat: "vegetables", name: "Carrot (Desi Red)", unit: "packet", icon: "🥕", price: 110, type: "regular" },
  { id: "veg-05", cat: "vegetables", name: "Bitter Gourd (Karela)", unit: "packet", icon: "🥒", price: 150, type: "premium" },
  { id: "veg-06", cat: "vegetables", name: "Bottle Gourd (Lauki)", unit: "packet", icon: "🥒", price: 140, type: "regular" },
  { id: "veg-07", cat: "vegetables", name: "Chili (Hot Pepper)", unit: "packet", icon: "🌶️", price: 160, type: "premium" },
  { id: "veg-08", cat: "vegetables", name: "Onion (Red Globe)", unit: "packet", icon: "🧅", price: 130, type: "regular" },
  { id: "veg-09", cat: "vegetables", name: "Cabbage (Golden Acre)", unit: "packet", icon: "🥬", price: 140, type: "regular" },
  { id: "veg-10", cat: "vegetables", name: "Cauliflower (Snowball)", unit: "packet", icon: "🥦", price: 150, type: "premium" },
  { id: "veg-11", cat: "vegetables", name: "Cucumber (Desi)", unit: "packet", icon: "🥒", price: 120, type: "regular" },
  { id: "veg-12", cat: "vegetables", name: "Radish (Muli)", unit: "packet", icon: "🌱", price: 90, type: "regular" },
  { id: "veg-13", cat: "vegetables", name: "Eggplant (Baingan)", unit: "packet", icon: "🍆", price: 130, type: "regular" },
  { id: "veg-14", cat: "vegetables", name: "Coriander (Dhania)", unit: "packet", icon: "🌿", price: 80, type: "regular" },

  // --- Flower Seeds ---
  { id: "flo-01", cat: "flowers", name: "Marigold (Genda)", unit: "packet", icon: "🌼", price: 100, type: "regular" },
  { id: "flo-02", cat: "flowers", name: "Rose (Mixed Colors)", unit: "packet", icon: "🌹", price: 200, type: "premium" },
  { id: "flo-03", cat: "flowers", name: "Sunflower", unit: "packet", icon: "🌻", price: 150, type: "premium" },
  { id: "flo-04", cat: "flowers", name: "Petunia", unit: "packet", icon: "🌸", price: 170, type: "premium" },
  { id: "flo-05", cat: "flowers", name: "Zinnia", unit: "packet", icon: "🌺", price: 110, type: "regular" },
  { id: "flo-06", cat: "flowers", name: "Cosmos", unit: "packet", icon: "🌸", price: 120, type: "regular" },
  { id: "flo-07", cat: "flowers", name: "Dahlia", unit: "packet", icon: "🌺", price: 210, type: "premium" },
  { id: "flo-08", cat: "flowers", name: "Daisy", unit: "packet", icon: "🌼", price: 100, type: "regular" },
  { id: "flo-09", cat: "flowers", name: "Chrysanthemum", unit: "packet", icon: "🌼", price: 160, type: "premium" },
  { id: "flo-10", cat: "flowers", name: "Portulaca (Moss Rose)", unit: "packet", icon: "🌸", price: 90, type: "regular" },
  { id: "flo-11", cat: "flowers", name: "Calendula", unit: "packet", icon: "🌼", price: 100, type: "regular" },
  { id: "flo-12", cat: "flowers", name: "Sweet Pea", unit: "packet", icon: "🌸", price: 140, type: "regular" },

  // --- Mix Seeds (collections) ---
  { id: "mix-01", cat: "mix", name: "Kitchen Garden Mix (8 veggies)", unit: "kit", icon: "🧺", price: 999, type: "standard-collection" },
  { id: "mix-02", cat: "mix", name: "Summer Flower Mix (6 varieties)", unit: "kit", icon: "🎁", price: 799, type: "standard-collection" },
  { id: "mix-03", cat: "mix", name: "Winter Vegetable Mix", unit: "kit", icon: "🧺", price: 999, type: "standard-collection" },
  { id: "mix-04", cat: "mix", name: "Herb Garden Mix", unit: "kit", icon: "🌿", price: 799, type: "standard-collection" },
  { id: "mix-05", cat: "mix", name: "Rooftop Garden Starter Mix", unit: "kit", icon: "🏡", price: 1599, type: "standard-collection" },
  { id: "mix-06", cat: "mix", name: "Butterfly Garden Flower Mix", unit: "kit", icon: "🦋", price: 999, type: "standard-collection" },
  { id: "mix-07", cat: "mix", name: "Balcony Pots Mix (compact plants)", unit: "kit", icon: "🪴", price: 999, type: "standard-collection" },
  { id: "mix-08", cat: "mix", name: "Salad Greens Mix", unit: "kit", icon: "🥗", price: 799, type: "standard-collection" },
  { id: "mix-09", cat: "mix", name: "Spice Garden Mix", unit: "kit", icon: "🌶️", price: 799, type: "standard-collection" },
  { id: "mix-10", cat: "mix", name: "Kids' First Garden Mix", unit: "kit", icon: "🧒", price: 799, type: "standard-collection" },
  { id: "mix-11", cat: "mix", name: "Build-Your-Own Seed Collection", unit: "kit", icon: "✨", price: 1999, type: "customized-collection" },

  // --- Fertilizer ---
  { id: "fer-01", cat: "fertilizer", name: "Organic Compost (2kg)", unit: "bag", icon: "🪴", price: 350, type: "regular" },
  { id: "fer-02", cat: "fertilizer", name: "Vermicompost (1kg)", unit: "bag", icon: "🪱", price: 280, type: "regular" },
  { id: "fer-03", cat: "fertilizer", name: "NPK Balanced (500g)", unit: "pack", icon: "🧪", price: 320, type: "regular" },
  { id: "fer-04", cat: "fertilizer", name: "Bone Meal (500g)", unit: "pack", icon: "🦴", price: 300, type: "regular" },
  { id: "fer-05", cat: "fertilizer", name: "Seaweed Liquid Fertilizer", unit: "bottle", icon: "🌊", price: 450, type: "premium" },
  { id: "fer-06", cat: "fertilizer", name: "Neem Cake Powder (1kg)", unit: "bag", icon: "🍃", price: 260, type: "regular" },
  { id: "fer-07", cat: "fertilizer", name: "Potting Mix Soil (5kg)", unit: "bag", icon: "🪴", price: 400, type: "regular" },
  { id: "fer-08", cat: "fertilizer", name: "Root Booster Solution", unit: "bottle", icon: "🧴", price: 380, type: "regular" },
  { id: "fer-09", cat: "fertilizer", name: "Micronutrient Mix (250g)", unit: "pack", icon: "✨", price: 340, type: "regular" },
  { id: "fer-10", cat: "fertilizer", name: "Cow Dung Manure (3kg)", unit: "bag", icon: "🐄", price: 220, type: "regular" },
];

const CATEGORY_META = {
  vegetables: { label: "Vegetable Seeds", accent: "leaf", tagline: "Grow your own kitchen garden" },
  flowers:    { label: "Flower Seeds",    accent: "marigold", tagline: "Colour for every season" },
  mix:        { label: "Mix Seeds",       accent: "chili", tagline: "Curated kits, ready to plant" },
  fertilizer: { label: "Fertilizer",      accent: "soil", tagline: "Feed the soil, feed the harvest" },
};

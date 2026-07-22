/* =====================================================================
   DEMO PRESETS — per-studio personalisation for the sales demo.

   One generic build serves everyone. To tailor the demo for a lead, add
   an entry here keyed by a short slug, then send them:

       https://your-demo-domain/book?studio=<slug>

   e.g. the "classic-tattoo" entry below is shown at
       /book?studio=classic-tattoo

   Everything here is DISPLAY-ONLY. The real booking engine (availability,
   the deposit checkout, stored bookings) keeps running on the generic
   seeded artists/services underneath — the page just relabels them. So
   nothing breaks if a lead clicks through and books.

   Fields (all optional except you'll usually want name + artists):
     name        — studio/artist name shown in header / title / sidebar / footer
     tagline     — script sub-line under the wordmark (defaults to the house one)
     headerImage — URL/path of a photo shown framed above the wordmark; if it
                   fails to load the header quietly falls back to text
     artists     — [{ name, styles, rate }]  (rate is the small line on the card)
     services    — [{ name, price, duration, description }]  (price in whole £,
                   omit for "varies"; duration in minutes and description are
                   display-only overrides for the seeded service they relabel)

   Optional visual FLASH picker (see "inked-byro" below):
     flash       — turns the flow into "choose your flash → date/time → your
                   details" (the artist step is skipped, solo artist auto-
                   selected). Shape:
                     flash: {
                       intro:  "…" (optional line above the picker),
                       rules:  { ink:[…], maxSize:"…", noPlacements:"…" },
                       sheets: [{ id, name, img, imgFallback }]  // zoomable gallery
                     }
                   The `services` array becomes the SELECTABLE TIERS the
                   customer picks (for this artist: quantity — 1/2/3 designs),
                   each mapping to a real seeded service so pricing/availability/
                   booking keep working. The sheets are a browsable, tap-to-zoom
                   catalogue (designs are named on the sheet, chosen by text on
                   the details step). `sheets[].img` is the artwork; if it 404s
                   it falls back to `imgFallback` then a text tile. `currency`
                   (top-level, default "£") sets the price symbol shown.

   Notes:
     • The generic seed has 2 artists and 6 services. If a preset lists
       MORE than that, the extras reuse a real one's calendar under the
       hood — invisible in a quick demo, but for the cleanest result keep
       artists ≤ 2 (or ask to extend the seed). Services can be any count.
     • If ?studio= doesn't match a slug here, it's treated as a plain
       studio NAME (e.g. ?studio=Golden+Goose+Tattoo just swaps the name).
   ===================================================================== */

window.DEMO_PRESETS = {
  "classic-tattoo": {
    name: "Classic Tattoo Studio",
    artists: [
      { name: "Mike Ross",  styles: "American traditional, bold colour", rate: "£380 full day / £190 half day" },
      { name: "Sara Lin",   styles: "Fine line, botanical, script",       rate: "£380 full day / £190 half day" },
    ],
    services: [
      { name: "Full day session", price: 380 },
      { name: "Half day session", price: 190 },
      { name: "Walk-in flash",    price: 120 },
      { name: "Consultation",     price: 0 },
    ],
  },

  // Black Craft Custom Tattoos — Craig's real August availability. The
  // `availability` map turns the calendar into a curated one: ONLY these
  // dates are bookable, each showing exactly the slots Craig offers. Keys are
  // dates (YYYY-MM-DD); each entry names a service (must match `services`
  // above/below) and a start time (HH:MM).
  "black-craft": {
    name: "Black Craft Custom Tattoos",
    artists: [
      { name: "Craig", styles: "Custom blackwork, traditional", rate: "£350 full day / £175 half day" },
    ],
    services: [
      { name: "Full day session", price: 350 },   // 9:30am–2:30pm
      { name: "Half day session", price: 175 },   // 4pm–7pm
    ],
    availability: {
      "2026-08-24": [ { service: "Full day session", start: "09:30" }, { service: "Half day session", start: "16:00" } ],
      "2026-08-26": [ { service: "Full day session", start: "09:30" }, { service: "Half day session", start: "16:00" } ],
      "2026-08-28": [ { service: "Full day session", start: "09:30" } ],
      "2026-08-31": [ { service: "Full day session", start: "09:30" }, { service: "Half day session", start: "16:00" } ],
    },
  },

  // Kenzie Katz — Hidden Gem Cardiff. Solo handpoke tattooist. Her Acuity-style
  // deposit menu (small / medium / large + touch-up), priced in £, with her
  // photo as the page header (drop the file at public/kenzie-katz.jpg — a
  // portrait crop works best; if it's missing the header falls back to text).
  // `availability` makes the calendar curated: only these August dates are
  // bookable, each offering exactly the slots below.
  "hidden-gem-cardiff": {
    name: "Kenzie Katz",
    tagline: "Hidden Gem Cardiff · handpoke tattoo studio",
    headerImage: "/kenzie-katz.png",
    headerImageFallback: "/kenzie-katz-placeholder.svg",
    artists: [
      { name: "Kenzie Katz", styles: "Handpoke · nature, still life, surrealism", rate: "Handpoke tattooist — deposit comes off your total" },
    ],
    services: [
      {
        name: "Small Tattoo Deposit (1-3 inches)", price: 85, duration: 90,
        description: "Secures your appointment for a small custom tattoo. Select this once you've contacted me and had a quote — the deposit comes off the total on the day. Any small tattoo 1-3 inches can vary with size and detail; the minimum is £85.",
      },
      {
        name: "Medium Tattoo Deposit (3.5-5 inches)", price: 200, duration: 120,
        description: "Secures your appointment for a medium custom tattoo. Select this once you've contacted me and had a quote — the deposit comes off the total on the day. Medium pieces vary with size and detail; my minimum is £200.",
      },
      {
        name: "Large Tattoo Deposit (5.5+)", price: 300, duration: 240,
        description: "Secures your appointment for a large custom tattoo. Select this once you've contacted me and had a quote — the deposit comes off the total on the day. Large pieces vary with size and detail; my minimum is £300.",
      },
      {
        name: "Tattoo Touch Up", price: 20, duration: 30,
        description: "Touch-Up Policy: if you cancel or reschedule with less than 48 hours notice, and don't rebook within 24 hours of your original time, you'll no longer qualify for touch-up pricing and will need to book a new full appointment.",
      },
    ],
    availability: {
      "2026-08-04": [ { service: "Small Tattoo Deposit (1-3 inches)", start: "11:00" }, { service: "Medium Tattoo Deposit (3.5-5 inches)", start: "13:30" } ],
      "2026-08-06": [ { service: "Large Tattoo Deposit (5.5+)", start: "11:00" } ],
      "2026-08-11": [ { service: "Small Tattoo Deposit (1-3 inches)", start: "11:00" }, { service: "Small Tattoo Deposit (1-3 inches)", start: "14:00" }, { service: "Tattoo Touch Up", start: "16:30" } ],
      "2026-08-13": [ { service: "Medium Tattoo Deposit (3.5-5 inches)", start: "11:00" } ],
      "2026-08-18": [ { service: "Large Tattoo Deposit (5.5+)", start: "11:00" } ],
      "2026-08-20": [ { service: "Small Tattoo Deposit (1-3 inches)", start: "11:00" }, { service: "Tattoo Touch Up", start: "15:00" } ],
      "2026-08-25": [ { service: "Medium Tattoo Deposit (3.5-5 inches)", start: "11:00" }, { service: "Small Tattoo Deposit (1-3 inches)", start: "14:30" } ],
      "2026-08-27": [ { service: "Large Tattoo Deposit (5.5+)", start: "11:00" } ],
    },
  },

  // inked.byro — Roomina, a solo FLASH tattoo artist (her real Instagram flash
  // offer). She posts a monthly flash sheet (Jan–Jun so far) and books the
  // current Jul/Aug/Sep drop off them. Customers used to DM: full name, phone,
  // email, selected design, placement & size, preferred days/times. This preset
  // replaces that with a zoomable sheet gallery + quantity picker → curated
  // calendar → a details form matching her checklist. Pricing is by QUANTITY
  // (her posted bundle: 1/$75, 2/$135, 3/$185) — the `services` are those tiers,
  // mapped onto real seeded services; `availability` is keyed by their names.
  // Drop her real sheet scans at public/flash/<id>.jpg (january.jpg … june.jpg)
  // — until then the generated placeholders (public/flash/<id>.svg) show.
  "inked-byro": {
    name: "Denver Fine Line Tattoos",
    tagline: "Roomina · monthly flash",
    currency: "$",
    hoursBlurb: "Private studio — by appointment only. Book a flash slot below.",
    headerImage: "/Roomina.jpg",
    headerImageFallback: "/inked-byro-placeholder.svg",
    artists: [
      { name: "Roomina", styles: "Flash · fine-line, illustrative", rate: "Flash only — black or red ink" },
    ],
    // Quantity bundle from her post. Duration grows with the count so the
    // curated slots space out sensibly; the exact designs are named on the
    // details step (any designs, from any sheet).
    services: [
      { name: "1 design",  price: 75,  duration: 60,  description: "Any one flash design, up to 2 inches. Black or red ink." },
      { name: "2 designs", price: 135, duration: 90,  description: "Any two flash designs (from any sheet), up to 2 inches each." },
      { name: "3 designs", price: 185, duration: 120, description: "Any three flash designs — best value. Up to 2 inches each." },
    ],
    flash: {
      intro: "Browse the monthly flash sheets — tap any sheet to zoom in and read the designs — then choose how many you'd like.",
      rules: {
        ink: ["Black", "Red"],
        maxSize: "2 inches (depending on design)",
        noPlacements: "hands, fingers, neck, or feet",
      },
      sheets: [
        { id: "jan", name: "January Flash",  img: "/flash/January.png",  imgFallback: "/flash/january.svg" },
        { id: "feb", name: "February Flash", img: "/flash/February.png", imgFallback: "/flash/february.svg" },
        { id: "mar", name: "March Flash",    img: "/flash/March.png",    imgFallback: "/flash/march.svg" },
        { id: "apr", name: "April Flash",    img: "/flash/April.png",    imgFallback: "/flash/april.svg" },
        { id: "may", name: "May Flash",      img: "/flash/May.png",      imgFallback: "/flash/may.svg" },
        { id: "jun", name: "June Flash",     img: "/flash/june.png",     imgFallback: "/flash/june.svg" },
      ],
    },
    // Curated Jul–Sep 2026 availability (her current drop window), keyed by
    // quantity tier. Bigger bundles take longer, so they get fewer slots.
    availability: {
      "2026-07-22": [ { service: "1 design", start: "11:00" }, { service: "1 design", start: "12:00" }, { service: "2 designs", start: "14:00" } ],
      "2026-07-25": [ { service: "1 design", start: "11:00" }, { service: "2 designs", start: "13:00" }, { service: "3 designs", start: "15:00" } ],
      "2026-07-29": [ { service: "1 design", start: "11:00" }, { service: "1 design", start: "12:00" }, { service: "1 design", start: "13:00" } ],
      "2026-08-05": [ { service: "1 design", start: "11:00" }, { service: "2 designs", start: "13:00" } ],
      "2026-08-08": [ { service: "3 designs", start: "11:00" } ],
      "2026-08-12": [ { service: "1 design", start: "11:00" }, { service: "1 design", start: "12:00" }, { service: "2 designs", start: "14:00" } ],
      "2026-08-19": [ { service: "1 design", start: "11:00" }, { service: "2 designs", start: "13:00" }, { service: "1 design", start: "15:00" } ],
      "2026-08-22": [ { service: "3 designs", start: "11:00" } ],
      "2026-08-26": [ { service: "1 design", start: "11:00" }, { service: "1 design", start: "12:00" }, { service: "1 design", start: "13:30" } ],
      "2026-09-02": [ { service: "1 design", start: "11:00" }, { service: "2 designs", start: "13:00" } ],
      "2026-09-05": [ { service: "3 designs", start: "11:00" }, { service: "1 design", start: "14:30" } ],
      "2026-09-09": [ { service: "1 design", start: "11:00" }, { service: "2 designs", start: "13:30" } ],
      "2026-09-16": [ { service: "1 design", start: "11:00" }, { service: "1 design", start: "12:00" }, { service: "2 designs", start: "14:00" } ],
      "2026-09-19": [ { service: "3 designs", start: "11:00" } ],
    },
  },

  // Add more studios here, e.g.:
  // "golden-goose": {
  //   name: "Golden Goose Tattoo",
  //   artists: [{ name: "Jamie Fox", styles: "Neo-traditional", rate: "£400 full day" }],
  //   services: [{ name: "Full day", price: 400 }, { name: "Half day", price: 210 }],
  // },
};

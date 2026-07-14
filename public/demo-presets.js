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
     name     — studio name shown in the header / title / sidebar / footer
     artists  — [{ name, styles, rate }]  (rate is the small line on the card)
     services — [{ name, price }]  (price in whole £; omit for "varies")

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

  // Add more studios here, e.g.:
  // "golden-goose": {
  //   name: "Golden Goose Tattoo",
  //   artists: [{ name: "Jamie Fox", styles: "Neo-traditional", rate: "£400 full day" }],
  //   services: [{ name: "Full day", price: 400 }, { name: "Half day", price: 210 }],
  // },
};

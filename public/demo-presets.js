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

  // Add more studios here, e.g.:
  // "golden-goose": {
  //   name: "Golden Goose Tattoo",
  //   artists: [{ name: "Jamie Fox", styles: "Neo-traditional", rate: "£400 full day" }],
  //   services: [{ name: "Full day", price: 400 }, { name: "Half day", price: 210 }],
  // },
};

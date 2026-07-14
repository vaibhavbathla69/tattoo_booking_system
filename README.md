# Iron & Ink — Tattoo Studio Booking System

A small web app with two sides sharing one booking database:

- **Customer booking page** (`/`) — public, self-service. Pick an artist, date, and free slot; leave your details; done. Slots respect opening hours and existing booking durations, so double-bookings are impossible.
- **Owner AI chat** (`/owner.html`) — password-protected. The owner talks to an AI assistant (via OpenRouter) that reads and writes the same database through tools: "what's on today", "add a booking for Dan, 3pm, Jake's chair", "who hasn't been in for 6 months?".

## Run it

```sh
npm install
npm start
```

Then open http://localhost:3000 (booking) and http://localhost:3000/owner.html (owner chat).

## Configuration (`.env`)

| Variable | Purpose |
|---|---|
| `OPENROUTER_API_KEY` | Powers the owner AI chat. Booking page works without it. Get one at https://openrouter.ai/keys |
| `OPENROUTER_MODEL` | Model slug the assistant uses — any from https://openrouter.ai/models (default `anthropic/claude-3.7-sonnet`) |
| `OWNER_PASSWORD` | Password for the owner page (default in `.env`: `inkadmin` — change it) |
| `PORT` | Web server port (default 3000) |

## How it's put together

```
src/
  db.js            SQLite schema + seed (artists, hours, clients, bookings)
  availability.js  Slot computation: opening hours + overlap with booking durations
  ai.js            OpenRouter integration (OpenAI SDK): 11 tools + agentic tool-use loop + system prompt
  server.js        Express: public booking API, owner auth, chat endpoint
public/
  index.html/app.js/style.css   Customer booking flow
  owner.html/owner.js           Owner chat UI
data/studio.db     Created on first run (gitignored)
```

**Clients are deduplicated by name + email** — a returning customer's history accumulates on one record, which is the point: the studio owns its client list.

**The AI's guardrails** live in the system prompt in `src/ai.js`: it must confirm before cancelling or moving any booking, never invents data (everything comes from tool results), never shows IDs or technical output, and stays brief.

## Customising

- **Artists and opening hours** are seeded on first run in `src/db.js`. Edit the seed and delete `data/studio.db` to re-seed, or update the `artists` / `studio_hours` tables directly.
- **Slot length** is 60 minutes for customer bookings (`SLOT_MINUTES` in `src/availability.js`); the owner can book any duration via chat and long sessions block multiple slots.

## Out of scope (by design, for now)

Confirmation emails, online deposits, staff accounts, SMS reminders, multi-location.

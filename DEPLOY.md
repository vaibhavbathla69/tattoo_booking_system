# Deploying the demo to Render

The app is a Node/Express server with a SQLite database and Stripe webhooks.
`data/` and `.env` are gitignored, so the server **seeds a fresh, clean
database on the host** — your local test data does not deploy.

## 1. Put the code on GitHub

From this folder:

```bash
git init
git add -A
git commit -m "Tattoo booking demo"
git branch -M main
# create an EMPTY repo on github.com first (private is fine), then:
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

## 2. Create the service on Render

1. render.com → **New +** → **Blueprint** → connect the GitHub repo.
   Render reads `render.yaml` and creates the web service.
   (Or **New + → Web Service**, Build `npm install`, Start `node src/server.js`.)
2. When prompted, fill in the **secret** env vars:
   - `OWNER_PASSWORD` — a NEW strong password (don't reuse the local one)
   - `OPENROUTER_API_KEY` — for the owner AI chat (optional; booking works without)
   - `STRIPE_SECRET_KEY` — your **sk_test_…** key (demo mode also refuses sk_live_)
   - `STRIPE_WEBHOOK_SECRET` — leave blank for now; set in step 4
   - `PUBLIC_BASE_URL` — leave blank for now; set in step 3
3. Deploy. Render gives you a URL like `https://tattoo-booking-demo.onrender.com`.

## 3. Point the app at its real URL

Set `PUBLIC_BASE_URL` to the Render URL (so Stripe redirects back correctly),
then trigger a redeploy (Manual Deploy → Deploy latest commit).

## 4. Wire the Stripe webhook (production)

`stripe listen` is only for local dev. In production:

1. Stripe dashboard (test mode) → **Developers → Webhooks → Add endpoint**
2. Endpoint URL: `https://<your-render-url>/api/webhooks/stripe`
3. Events: `checkout.session.completed` and `checkout.session.expired`
4. Copy the endpoint's **Signing secret** (`whsec_…`) into Render's
   `STRIPE_WEBHOOK_SECRET`, then redeploy.

## 5. Test it

- Booking page: `https://<your-render-url>/book?studio=classic-tattoo`
- Owner dashboard: `https://<your-render-url>/owner.html`
- Make a booking with test card `4242 4242 4242 4242` and confirm it appears
  on the owner calendar (proves the webhook works).

## Notes

- **Free plan** sleeps after ~15 min idle (first hit is a slow cold start) and
  has no persistent disk, so the DB resets to clean seed data on restart —
  which is usually what you want for a sales demo. For always-on + persistence,
  upgrade the instance and add a Disk mounted at `.../data`.
- Send tailored links by adding studios to `public/demo-presets.js` and using
  `?studio=<slug>` (e.g. `/book?studio=classic-tattoo`).
- Keep `DEMO_MODE=true` on the demo so no real card can ever be charged.

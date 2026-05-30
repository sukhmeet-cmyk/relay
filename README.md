# RELAY — Dispatch Tracking

A self-hosted, MacroPoint-style live tracking tool. You create a load, get a
**public tracking link**, and send it to your (outsourced) driver. The driver
opens it on their phone, taps **Start Sharing**, and their live GPS shows up on
your dispatcher map.

- **Dispatcher dashboard** — `/` (protected by a key)
- **Driver page** — `/t/<token>` (public link, mobile-friendly)
- No database to install. One dependency (Express). Persists to `data.json`.

---

## Run locally (1 minute)

```bash
npm install
ADMIN_KEY=mysecret npm start
```

Open http://localhost:3000 → sign in with `mysecret`.
Create a load, copy the tracking link, open it in another tab/phone, Start Sharing.

> On `localhost` and any `https://` site, phone GPS works. On a plain `http://`
> address that is **not** localhost, browsers block location — so deploy with
> HTTPS (all hosts below give you HTTPS automatically).

---

## Publish it (Render — free, ~10 min)

1. Put this folder in a GitHub repo (`git init`, commit, push).
2. Go to **render.com → New → Web Service** and pick your repo.
3. Settings:
   - **Build command:** `npm install`
   - **Start command:** `node server.js`
4. **Environment** → add:
   - `ADMIN_KEY` = a long random password (your dispatcher login)
   - `PUBLIC_URL` = the URL Render gives you, e.g. `https://relay-xyz.onrender.com`
   - *(optional)* `TWILIO_SID`, `TWILIO_TOKEN`, `TWILIO_FROM` to enable SMS
5. Deploy. Visit your URL, sign in, you're live.

**Railway / Fly.io / a VPS** work the same way: install deps, run `node server.js`,
set the env vars, make sure it's served over HTTPS.

---

## Sending the link to a driver

Open a load → **Copy Link** and paste it into WhatsApp / SMS / email yourself,
**or** add Twilio env vars and use the **Text Link** button to text it directly.

Twilio: create a free account, get a phone number, copy the Account SID + Auth
Token from the console, set the three `TWILIO_*` vars. Driver phone numbers must
be in E.164 format (`+15551234567`).

---

## Environment variables

| Variable | Required | What it does |
|---|---|---|
| `ADMIN_KEY` | strongly recommended | Dispatcher login. Default `changeme` — **change it.** |
| `PUBLIC_URL` | recommended | Base URL used in tracking links & SMS. |
| `PORT` | no | Host usually sets this automatically. |
| `DATA_FILE` | no | Where data is stored. Default `./data.json`. |
| `TWILIO_SID` / `TWILIO_TOKEN` / `TWILIO_FROM` | no | Enables the Text Link button. |

---

## Honest limitations (read before you rely on it)

- **The driver's tab must stay open with the screen on.** Phone browsers suspend
  background tabs, so GPS pauses if the driver locks the screen or switches apps
  for a while. This is a browser limit — true passive tracking needs a native app
  or ELD/telematics integration. The link approach is exactly how MacroPoint's
  *web* fallback behaves; their always-on tracking uses an installed app.
- **Data persistence on free hosts is ephemeral.** `data.json` survives while the
  app runs but can reset on redeploy/restart. For production, attach a persistent
  disk (Render "Disks") pointed at `DATA_FILE`, or swap the JSON store for
  Postgres. Tell me if you want the Postgres version.
- **Security is intentionally simple** (one shared dispatcher key). Fine for a
  small team or pilot. For multiple dispatcher accounts, you'd add real user auth.
- Drivers must **consent** and grant location permission — by design.

---

## File map

```
server.js          backend + API + SMS
public/index.html  dispatcher dashboard
public/track.html  driver tracking page (served at /t/:token)
package.json        deps + start script
.env.example        copy to .env for local dev
```

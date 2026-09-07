# Keka Remote Punch

A one-page Next.js app for remote clock in / clock out against
`cloudanalogy.keka.com`, with an optional **auto clock-out** that fires hours
later even if your laptop is closed.

## Run

```bash
npm run dev     # http://localhost:3000
```

## Use

1. Open Keka in your browser, DevTools → Network, and copy the value of the
   `authorization` header (everything after `Bearer `) from any API call.
2. Paste it into the token box. It is saved in `localStorage`, so you only
   re-paste when it expires (Keka tokens last about 24 hours).
3. Hit **Clock In** or **Clock Out**.
4. To clock out automatically, tick **Auto clock-out after**, pick a duration,
   then Clock In. A countdown appears; **cancel** kills the pending punch, and a
   manual Clock Out cancels it for you.

## How auto clock-out works

A five-hour delay cannot live inside a Vercel function — `after()` is capped at
the route's max duration, and Hobby cron only runs once a day with ±59 min
precision. So the wait is held by [Upstash QStash](https://upstash.com/docs/qstash):

1. `POST /api/schedule` encrypts your token (AES-256-GCM) and publishes a QStash
   message with `notBefore` set to the fire time.
2. QStash holds it, then `POST`s back to `/api/auto-clockout` at that moment.
3. That route verifies the QStash signature, decrypts the token, and punches out.

No database: the encrypted token rides inside the message payload. QStash stores
only ciphertext it has no key for.

Cancelling deletes the QStash message by id (`POST /api/schedule/cancel`).

### Setup

Create a QStash instance at <https://console.upstash.com/qstash> and set these
in Vercel → Settings → Environment Variables (see `.env.example`):

| Variable | Where it comes from |
| --- | --- |
| `QSTASH_TOKEN` | QStash console |
| `QSTASH_CURRENT_SIGNING_KEY` | QStash console |
| `QSTASH_NEXT_SIGNING_KEY` | QStash console |
| `TOKEN_ENC_KEY` | `openssl rand -base64 32` |
| `AUTO_CLOCKOUT_BASE_URL` | Optional. Defaults to your Vercel production domain |

**Deployment Protection must be off** for the production deployment, or QStash's
callback gets bounced by Vercel's auth wall before it reaches the route. If you
need protection on, add a bypass secret and append it to the callback URL.

### Local testing

```bash
npx @upstash/qstash-cli dev -port=8080
```

Put the credentials it prints into `.env.local`, add
`AUTO_CLOCKOUT_BASE_URL=http://localhost:3100`, and run `npx next dev -p 3100`.

## Guard rails

- **Token expiry.** Scheduling is refused if the token would expire before the
  timer fires (with a 5-minute margin), since that punch would only ever 401.
- **Duration.** Between 1 minute and 16 hours.
- **Retries.** QStash retries 3 times, but the callback returns `200` on a `401`
  so a dead token doesn't get retried pointlessly.
- **It fires whether or not you are still working.** If you are at your desk when
  the timer expires, it files a real clock-out anyway.

## API

| Route | Purpose |
| --- | --- |
| `POST /api/punch` | Immediate clock in/out. `{ token, action: "in" \| "out", note? }` |
| `POST /api/schedule` | Schedule an auto clock-out. `{ token, minutes, note? }` |
| `POST /api/schedule/cancel` | Cancel a pending one. `{ messageId }` |
| `POST /api/auto-clockout` | QStash callback. Signature-verified, not for manual use |

`originalPunchStatus` is `0` for clock in and `1` for clock out — that single
field is the only difference between the two Keka requests.

## Security notes

The browser cannot call Keka directly (CORS), so the token always passes through
this app's server. For an immediate punch it is used and discarded. For an auto
clock-out an **encrypted copy is held by QStash** until the timer fires — that is
inherent to punching out while your machine is off. The token grants access to
your whole Keka account, not just attendance, so keep `TOKEN_ENC_KEY` secret and
rotate it if you suspect exposure (rotating orphans any in-flight schedules).

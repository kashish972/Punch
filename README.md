# Keka Remote Punch

A one-page Next.js app for remote clock in / clock out against
`cloudanalogy.keka.com`.

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

The page shows the username and expiry decoded from the token, so you can see
at a glance whether it is still good.

## How it works

The browser cannot call Keka directly — CORS blocks it. `POST /api/punch`
(see [app/api/punch/route.ts](app/api/punch/route.ts)) takes `{ token, action,
note }`, builds the payload Keka expects and forwards it server-side:

```json
{
  "timestamp": "<now, ISO 8601>",
  "attendanceLogSource": 1,
  "locationAddress": null,
  "manualClockinType": 3,
  "note": "",
  "originalPunchStatus": 0
}
```

`originalPunchStatus` is `0` for clock in and `1` for clock out — that single
field is the only difference between the two requests.

The token is never stored on the server; it lives in your browser and is
passed through per request.

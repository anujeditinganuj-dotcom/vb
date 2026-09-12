# VidBunker Resolver (Vercel)

A thin proxy in front of the already-working `vidbunker-dl.dxsdl1.workers.dev`
Cloudflare Worker, so a vidbunker.in watch link can be resolved/streamed
from your own Vercel deployment instead of the third-party `dgxserver.online`
frontend.

## Why it's built this way

vidbunker.in itself blocks plain automated fetches (robots-disallowed), so
this project doesn't try to re-implement resolving its pages from scratch.
Instead it calls the Cloudflare Worker that's already confirmed (live,
2026-09-12) to do that successfully:

- `GET  https://vidbunker-dl.dxsdl1.workers.dev/api/download?url=<link>`
  → streams the raw video directly (confirmed: a browser navigated straight
  to this URL played the video inline).
- `POST https://vidbunker-dl.dxsdl1.workers.dev/api/download` with
  `{"url": "<link>"}` → documented by the worker's own status page as the
  "resolve" form, but its exact response shape (JSON with a direct link,
  vs. also just streaming bytes) was **not independently confirmed** while
  building this — `api/resolve.js` handles both possibilities rather than
  assuming one.

## Endpoints

- `GET /` — status/usage JSON.
- `GET /api/resolve?url=<vidbunker watch URL>` — default `mode=resolve`:
  tries the worker's POST form for a lightweight JSON reply first; if that
  doesn't come back as JSON, automatically falls back to streaming the
  video directly instead.
- `GET /api/resolve?url=<link>&mode=stream` — always streams the video
  through this function (skips the POST attempt).
- `POST /api/resolve` with a JSON body `{"url": "<link>"}` — same as
  above, url read from the body instead of the query string.

## Known limitation: long/large videos in `mode=stream`

Vercel functions have a maximum execution duration (`maxDuration` in
`vercel.json`, set here to 60s — the max on the Hobby plan; Pro plans can
go higher). Streaming a video through this function only finishes if the
whole transfer completes inside that window. For a short clip this is
fine; for a long video (the one this was tested against was ~40 minutes)
it may not fully complete on a slow connection.

This is exactly why `mode=resolve` is the default and tries to get a
direct link from the worker's POST form first — if that works, this
function's own response is tiny and instant, and whatever fetches the
direct link afterward isn't bound by *this* function's time limit at all.
`mode=stream` is kept as a working fallback/fully-self-contained option,
not the primary path.

## Deploying

1. `vercel deploy` (or connect this repo in the Vercel dashboard) — no
   environment variables or secrets needed, since this only calls a public
   worker endpoint.
2. Test: `curl "https://<your-deployment>.vercel.app/api/resolve?url=https://vidbunker.in/watch/sJ3DYlunn"`

## What to check if the upstream worker's behavior changes

This project has no visibility into `vidbunker-dl.dxsdl1.workers.dev`'s own
internal logic (only its confirmed public HTTP behavior above) — if
vidbunker.in changes its site and that worker breaks or starts returning
something different, `api/resolve.js` will need updating to match whatever
the worker (or a replacement resolver) actually returns at that point.

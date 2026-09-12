// api/resolve.js
//
// VidBunker resolver — thin proxy in front of the ALREADY-WORKING
// Cloudflare Worker at vidbunker-dl.dxsdl1.workers.dev, confirmed live
// (2026-09-12) to:
//   - Reject unauthenticated fetches of vidbunker.in itself (robots-
//     blocked from most tools, but the worker clearly has its own way
//     past that — internals not visible to us, and don't need to be)
//   - GET  /api/download?url=<vidbunker watch URL>  -> streams the raw
//     video bytes directly (confirmed: browser played it inline as
//     video/mp4 when navigated to directly)
//   - POST /api/download { url: '...' }  -> documented by the worker's
//     own "/" status JSON as the "resolve" form, but its actual response
//     shape (JSON with a direct link vs. also just streaming bytes) is
//     UNCONFIRMED — resolveViaPost() below handles both possibilities
//     rather than assuming one, since guessing wrong here is exactly the
//     class of bug this whole project's build history has run into
//     repeatedly with third-party APIs.
//
// Two modes, chosen by ?mode=:
//   mode=resolve (default) — tries the worker's POST form first for a
//     lightweight JSON response (ideal — avoids proxying the whole file
//     through this function at all). If that doesn't come back as JSON,
//     falls back to mode=stream automatically.
//   mode=stream — proxies the worker's GET endpoint directly, piping
//     the video through this function. Works, but see the README for
//     why a long/large video may not fully complete within Vercel's
//     function duration limit — mode=resolve avoiding this entirely is
//     why it's the default.
//
// Accepts the target link as either ?url=... (GET) or a JSON body
// {"url": "..."} (POST) — either method works for either mode.

export const config = {
  runtime: "edge", // streams the response instead of buffering the whole
                    // video in memory first — required for mode=stream
                    // to work at all for anything but a tiny file.
};

const WORKER_BASE = "https://vidbunker-dl.dxsdl1.workers.dev";
const VIDBUNKER_URL_RE = /^https?:\/\/(?:www\.)?vidbunker\.in\/watch\/[A-Za-z0-9]+\/?$/;

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

async function getTargetUrl(req, searchParams) {
  const fromQuery = searchParams.get("url");
  if (fromQuery) return fromQuery;
  if (req.method === "POST") {
    try {
      const body = await req.json();
      if (body && typeof body.url === "string") return body.url;
    } catch {
      // no/invalid JSON body — fall through, caller reports the missing url
    }
  }
  return null;
}

async function resolveViaPost(targetUrl) {
  // Tries the worker's own documented "resolve" form. Returns a parsed
  // JSON object if that's what came back, or null if it didn't (so the
  // caller knows to fall back to mode=stream instead of guessing at a
  // shape that was never confirmed).
  const resp = await fetch(`${WORKER_BASE}/api/download`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: targetUrl }),
  });
  const contentType = resp.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    try {
      return { ok: resp.ok, status: resp.status, data: await resp.json() };
    } catch {
      return null;
    }
  }
  return null; // not JSON — likely streamed bytes again, same as GET
}

async function streamViaGet(targetUrl) {
  const streamUrl = `${WORKER_BASE}/api/download?url=${encodeURIComponent(targetUrl)}`;
  const upstream = await fetch(streamUrl);
  return upstream;
}

export default async function handler(req) {
  const { searchParams } = new URL(req.url);

  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  const targetUrl = await getTargetUrl(req, searchParams);
  if (!targetUrl) {
    return jsonResponse(
      { error: "Missing 'url' — pass ?url=<link> or a JSON body {\"url\": \"<link>\"}" },
      400,
    );
  }
  if (!VIDBUNKER_URL_RE.test(targetUrl)) {
    return jsonResponse(
      { error: "Only vidbunker.in/watch/<id> links are supported", got: targetUrl },
      400,
    );
  }

  const mode = (searchParams.get("mode") || "resolve").toLowerCase();

  try {
    if (mode === "resolve") {
      const resolved = await resolveViaPost(targetUrl);
      if (resolved !== null) {
        // Worker gave back real JSON — pass it through as-is. Whatever
        // fields it actually contains (a direct link, metadata, or an
        // error) are for the caller to read; this proxy doesn't reshape
        // a response whose real shape was never confirmed firsthand.
        return jsonResponse(resolved.data, resolved.status);
      }
      // POST didn't return JSON (or failed outright) — same fallback
      // path as an explicit mode=stream request.
    }

    const upstream = await streamViaGet(targetUrl);
    if (!upstream.ok || !upstream.body) {
      return jsonResponse(
        { error: `Upstream worker returned HTTP ${upstream.status}` },
        upstream.status || 502,
      );
    }

    const headers = new Headers();
    headers.set("Content-Type", upstream.headers.get("content-type") || "video/mp4");
    const contentLength = upstream.headers.get("content-length");
    if (contentLength) headers.set("Content-Length", contentLength);
    headers.set("Content-Disposition", 'inline; filename="video.mp4"');
    headers.set("Access-Control-Allow-Origin", "*");
    headers.set("Cache-Control", "no-store");

    return new Response(upstream.body, { status: 200, headers });
  } catch (e) {
    return jsonResponse({ error: `Proxy request failed: ${String(e)}` }, 502);
  }
}

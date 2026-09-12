// api/index.js
// Root status page — same "status"/"usage" JSON shape as the reference
// VidBunker proxy services this project fronts, so it's immediately
// familiar to anyone who's used those.

export const config = { runtime: "edge" };

export default async function handler(req) {
  const { origin } = new URL(req.url);
  return new Response(
    JSON.stringify(
      {
        status: "online",
        service: "VidBunker Resolver (Vercel)",
        usage: {
          resolve_get: `${origin}/api/resolve?url=https://vidbunker.in/watch/<id>`,
          resolve_post: `POST ${origin}/api/resolve  { "url": "https://vidbunker.in/watch/<id>" }`,
          stream: `${origin}/api/resolve?url=https://vidbunker.in/watch/<id>&mode=stream`,
        },
        notes: [
          "mode=resolve (default) returns JSON if the upstream worker's POST form does; otherwise falls back to streaming the video directly.",
          "mode=stream always proxies the raw video through this function — fine for short clips, but a long video may not finish within this platform's function-duration limit (see README).",
        ],
      },
      null,
      2,
    ),
    { status: 200, headers: { "Content-Type": "application/json" } },
  );
}

export default {
  // The app imports ../packages/* from outside its own directory, so tracing
  // is rooted at the repo (which also matches the Vercel project's
  // rootDirectory = dashboard-new). Fixture data is copied into ./data by the
  // prebuild script and included explicitly: fs reads through a computed
  // path are invisible to tracing.
  outputFileTracingRoot: new URL("..", import.meta.url).pathname,
  outputFileTracingIncludes: {
    "/f/[id]": ["./data/**/*", "dashboard-new/data/**/*"],
    "/": ["./data/**/*", "dashboard-new/data/**/*"],
    "/arena": ["./data/**/*", "dashboard-new/data/**/*"],
    "/api/run": ["./data/**/*", "dashboard-new/data/**/*"],
    "/api/live-status": ["./data/**/*", "dashboard-new/data/**/*"],
    "/api/arm": ["./data/**/*", "dashboard-new/data/**/*"],
    "/api/cron/tick": ["./data/**/*", "dashboard-new/data/**/*"],
    "/api/cron/fixtures": ["./data/**/*", "dashboard-new/data/**/*"],
  },
  // `packages/agent/initArena.ts` computes its CLI-only repo root as
  // `new URL("../..", import.meta.url)`. Bundlers read that literal as a static
  // asset reference and fail on the bare directory, which takes down every
  // route that transitively imports `live.ts`.
  //
  // The real fix is one line in initArena.ts (hold the specifier in a const so
  // it is not statically analyzable). It was tried and reverted: it changes the
  // esbuild output of the shipped `api/live-status.js`, and
  // `dashboard/build.mjs --check` treats any drift in the frozen deployed
  // bundles as a failure. So the workaround lives here until M6 retires that
  // build, and then initArena.ts gets the one-line fix.
  //
  // ROOT is dead weight server-side (routes read keys from env, never disk), so
  // pointing the specifier at a real file is safe. Verified 2026-07-18 that
  // `../..` appears as a module specifier nowhere else under packages/, server/,
  // or dashboard-new/, so this alias cannot capture an unrelated import.
  // Recheck before adding one:
  //   grep -rn 'from "\.\./\.\."' packages/ server/ dashboard-new/
  turbopack: {
    resolveAlias: { "../..": "./package.json" },
  },
};

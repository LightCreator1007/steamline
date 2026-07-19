export default {
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

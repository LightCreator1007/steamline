// Typed Vercel project config. The repo-root vercel.json still owns the
// frozen dashboard/ deploy until the M6 cutover; this file is the config for
// dashboard-new/ and is the only place cron schedules are declared.
//
// Cadence: one minute is the ingestion tick, which is also the tick thinning
// the engine already applies, so nothing is lost by not going finer.
// Detection is pre-match by design, so a missed minute costs at most one
// tick, never a signal.

interface CronJob {
  path: string;
  schedule: string;
}

interface VercelConfig {
  crons: CronJob[];
}

const config: VercelConfig = {
  crons: [
    { path: "/api/cron/tick", schedule: "* * * * *" },
    { path: "/api/cron/fixtures", schedule: "17 4 * * *" },
  ],
};

export default config;

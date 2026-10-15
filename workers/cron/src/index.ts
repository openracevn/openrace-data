/**
 * openrace-cron (plan 027, step 4): on each cron trigger, dispatches one of
 * openrace-data's workflows with `scheduled: true`, so the workflow treats the run
 * as a scheduled one (once a day, the trial-day gate). See wrangler.toml for times.
 */
interface Env {
  GITHUB_TOKEN: string;
  REPO: string;
}

/** Which workflow a trigger time starts (UTC hour; Monday for the digest). */
export function workflowFor(time: Date): string | null {
  const hour = time.getUTCHours();
  if (hour === 21) return "schedule-1.yml";
  if (hour === 22) return "schedule-2.yml";
  if (hour === 2 && time.getUTCDay() === 1) return "digest.yml";
  return null;
}

async function dispatch(env: Env, workflow: string): Promise<void> {
  const res = await fetch(`https://api.github.com/repos/${env.REPO}/actions/workflows/${workflow}/dispatches`, {
    method: "POST",
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${env.GITHUB_TOKEN}`,
      "User-Agent": "openrace-cron",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: JSON.stringify({ ref: "main", inputs: { scheduled: "true" } }),
  });
  if (!res.ok) throw new Error(`dispatch ${workflow}: ${res.status} ${await res.text()}`);
  console.log(`dispatched ${workflow}`);
}

export default {
  async scheduled(event: { scheduledTime: number }, env: Env): Promise<void> {
    const workflow = workflowFor(new Date(event.scheduledTime));
    if (!workflow) {
      console.log(`no workflow for ${new Date(event.scheduledTime).toISOString()}`);
      return;
    }
    if (!env.GITHUB_TOKEN) throw new Error("GITHUB_TOKEN secret not set (npx wrangler secret put GITHUB_TOKEN)");
    await dispatch(env, workflow);
  },
};

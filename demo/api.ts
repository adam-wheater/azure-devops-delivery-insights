// Sample data for the demo build: a fictional "Contoso" project with six
// pipelines and about three months of deployments. Every REST call the hub makes
// (definitions, builds, timelines, leases, changes, commits, pull requests, refs)
// is answered from the plan below, so the real analysis runs on it. See demo/kit.ts
// for the helpers.
import { CommonServiceIds, clientFactory, delay, extensionDataService, projectPageService } from "./kit";

export { CommonServiceIds };

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const now = Date.now();

// Small deterministic generator so every screenshot run shows the same data.
let seed = 33;
const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
const hex = (n: number) =>
  Array.from({ length: n }, () => "0123456789abcdef"[Math.floor(rand() * 16)]).join("");
const guid = () => `${hex(8)}-${hex(4)}-${hex(4)}-${hex(4)}-${hex(12)}`;

const PROJECT_ID = "6ce954b1-ce1f-45d1-b94d-e6bf2464ba2c";
const SAMPLE_USER_ID = "8d1f2c4e-5b6a-4c7d-9e8f-0a1b2c3d4e5f";
const OWNER_ID = "Released to PRD";

// How each repository merges. "noff" keeps the authored commit through develop and
// main; "squash" rewrites it at the develop merge; "trunk" has no develop branch;
// "direct" pushes straight to main with no pull requests.
type Flow = "noff" | "squash" | "trunk" | "direct";
interface Pipeline {
  id: number;
  name: string;
  flow: Flow;
  /** Average deploying builds per weekday-adjusted day. */
  perDay: number;
  /** Whether the pipeline writes a retention lease after a production deploy. */
  leases: boolean;
  repoId: string;
}

const pipelines: Pipeline[] = [
  { id: 21, name: "billing-api", flow: "noff", perDay: 0.55, leases: true, repoId: guid() },
  { id: 22, name: "web-portal", flow: "squash", perDay: 0.5, leases: true, repoId: guid() },
  { id: 23, name: "payments-worker", flow: "noff", perDay: 0.35, leases: true, repoId: guid() },
  { id: 24, name: "notifications-svc", flow: "squash", perDay: 0.3, leases: true, repoId: guid() },
  { id: 25, name: "identity-api", flow: "trunk", perDay: 0.22, leases: true, repoId: guid() },
  // The one pipeline that never got the lease step, so its releases are stage-inferred.
  { id: 26, name: "reporting-job", flow: "direct", perDay: 0.15, leases: false, repoId: guid() },
];
// Listed by the server but excluded in the seeded settings, so it is never scanned.
const EXCLUDED = { definitionId: 27, name: "nightly-redeploy" };

type Outcome = "ci" | "devOnly" | "qaFail" | "staged" | "prod" | "prodRetry" | "prodFail";

interface Stage {
  name: string;
  attempt: number;
  /** TaskResult: 0 succeeded, 2 failed, 4 skipped. */
  result: number;
  start: number | null;
  finish: number | null;
}

interface PlannedBuild {
  id: number;
  number: string;
  pipeline: Pipeline;
  outcome: Outcome;
  start: number;
  finish: number;
  stages: Stage[];
  /** Commit ids, newest first, as the changes endpoint returns them. */
  commits: string[];
  commitDate: number;
  merged: any[];
  produced: any[];
  leaseAt: number | null;
}

let nextPr = 1180;
const pr = (target: string, created: number, closed: number) => ({
  pullRequestId: nextPr++,
  status: 3,
  sourceRefName: `refs/heads/feature/${hex(6)}`,
  targetRefName: `refs/heads/${target}`,
  creationDate: new Date(created),
  closedDate: new Date(closed),
});

/** Lays out one build: its stage timeline, and the commit and pull-request history behind it. */
function plan(pipeline: Pipeline, start: number, outcome: Outcome, rush = false): PlannedBuild {
  const stages: Stage[] = [];
  let cursor = start;
  const run = (name: string, wait: number, lo: number, hi: number, result = 0, attempt = 1) => {
    const s = cursor + wait * MIN;
    const f = s + between(lo, hi) * MIN;
    stages.push({ name, attempt, result, start: s, finish: f });
    cursor = f;
  };
  const skip = (name: string) =>
    stages.push({ name, attempt: 1, result: 4, start: null, finish: null });

  run("Build", 0, 4, 11);
  if (outcome === "ci") return finishPlan(pipeline, start, outcome, stages, rush);
  run("Deploy_DEV", 1, 2, 4);
  if (outcome === "devOnly") {
    skip("Deploy_QA");
    skip("Deploy_STG");
    skip("Deploy_PRD");
    return finishPlan(pipeline, start, outcome, stages, rush);
  }
  run("Deploy_QA", between(3, 25), 4, 9, outcome === "qaFail" ? 2 : 0);
  if (outcome === "qaFail") {
    skip("Deploy_STG");
    skip("Deploy_PRD");
    return finishPlan(pipeline, start, outcome, stages, rush);
  }
  run("Deploy_STG", rush ? between(3, 10) : between(20, 80), 3, 6);
  if (outcome === "staged") {
    skip("Deploy_PRD");
    return finishPlan(pipeline, start, outcome, stages, rush);
  }
  const wait = rush ? between(8, 25) : between(30, 150);
  if (outcome === "prodFail") {
    run("Deploy_PRD", wait, 3, 7, 2);
  } else if (outcome === "prodRetry") {
    run("Deploy_PRD", wait, 3, 6, 2);
    run("Deploy_PRD", between(8, 20), 4, 9, 0, 2);
  } else {
    run("Deploy_PRD", wait, 4, 9);
  }
  return finishPlan(pipeline, start, outcome, stages, rush);
}

function finishPlan(
  pipeline: Pipeline,
  start: number,
  outcome: Outcome,
  stages: Stage[],
  rush: boolean
): PlannedBuild {
  const finish = Math.max(...stages.map((s) => s.finish ?? start));
  const deployed = outcome === "prod" || outcome === "prodRetry";

  // Work backwards from the build start: pull request merged to main, merged to
  // develop, then the commit. A hotfix skips most of the waiting.
  const relH = rush ? between(0.05, 0.3) : rand() < 0.15 ? between(2, 9) : between(0.05, 0.5);
  const intH = rush ? between(0.5, 2) : between(2, 13);
  const codeH = rush ? between(0.5, 3) : between(2, 14);
  const t2 = start - relH * HOUR;
  const t1 = t2 - intH * HOUR;
  const commits = Array.from({ length: 1 + Math.floor(rand() * 3) }, () => hex(40));

  let commitDate = start - codeH * HOUR;
  let merged: any[] = [];
  let produced: any[] = [];
  if (pipeline.flow === "noff") {
    commitDate = t1 - codeH * HOUR;
    merged = [pr("develop", commitDate, t1), pr("main", t1, t2)];
  } else if (pipeline.flow === "squash") {
    // The develop merge rewrites the commit, so its date is the merge itself and
    // the journey starts from when the pull request was opened.
    commitDate = t1;
    produced = [pr("develop", t1 - between(3, 20) * HOUR, t1)];
    merged = [pr("main", t1, t2)];
  } else if (pipeline.flow === "trunk") {
    commitDate = t2 - codeH * HOUR;
    merged = [pr("main", commitDate, t2)];
  } else {
    commitDate = start - between(0.1, 3) * HOUR;
  }

  const prod = stages.filter((s) => s.name === "Deploy_PRD" && s.result === 0);
  return {
    id: 0,
    number: "",
    pipeline,
    outcome,
    start,
    finish,
    stages,
    commits,
    commitDate,
    merged,
    produced,
    leaseAt: deployed && pipeline.leases && prod.length ? prod[prod.length - 1].finish! + 20_000 : null,
  };
}

// ── Schedule: busy days and quiet days across the last 88 days ────────────────────
const dayStart = (daysAgo: number) => {
  const d = new Date(now - daysAgo * DAY);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
};
// Two quiet days in every seven, counted back from today rather than read off the
// calendar, so the screenshots look the same whatever day they are taken on.
const dayFactor = (daysAgo: number) => (daysAgo % 7 === 3 || daysAgo % 7 === 4 ? 0.1 : 1.35);

function slots(rate: number): number[] {
  const out: number[] = [];
  for (let daysAgo = 88; daysAgo >= 0; daysAgo--) {
    for (let k = 0; k < 3; k++) {
      if (rand() < Math.min(1, (rate * dayFactor(daysAgo)) / 3)) {
        const startAt = dayStart(daysAgo) + between(8, 17.5) * HOUR;
        if (startAt < now - 3 * HOUR) out.push(startAt);
      }
    }
  }
  return out.sort((a, b) => a - b);
}

const pickOutcome = (): Outcome => {
  const roll = rand();
  return roll < 0.68
    ? "prod"
    : roll < 0.74
      ? "prodRetry"
      : roll < 0.775
        ? "prodFail"
        : roll < 0.815
          ? "qaFail"
          : roll < 0.9
            ? "staged"
            : "devOnly";
};

const done = (b: PlannedBuild) => b.finish < now - 10 * MIN;
let builds: PlannedBuild[] = [];

for (const p of pipelines) {
  let own = slots(p.perDay)
    .map((startAt) => plan(p, startAt, pickOutcome()))
    .filter(done);
  // The newest payments-worker deploy failed and nothing has fixed it yet, so any
  // slower build that would have finished after it is dropped.
  let stuck: PlannedBuild | null = null;
  if (p.name === "payments-worker" && own.length) {
    const failed = plan(p, own[own.length - 1].start, "prodFail", true);
    if (done(failed)) {
      own = own.slice(0, -1).filter((b) => b.finish < failed.finish).concat(failed);
      stuck = failed;
    }
  }
  // Most other production failures get a quick fix build; the rest wait for the next normal one.
  for (const failed of own.filter((b) => b.outcome === "prodFail" && b !== stuck)) {
    if (rand() < 0.75) {
      const fix = plan(p, failed.finish + between(15, 240) * MIN, "prod", true);
      if (done(fix)) own.push(fix);
    }
  }
  builds.push(...own);
  // Plain CI builds with no deployment stages.
  builds.push(
    ...slots(p.perDay * 0.6)
      .map((startAt) => plan(p, startAt, "ci"))
      .filter(done)
  );
}

builds.sort((a, b) => a.start - b.start);
const perDayCount = new Map<string, number>();
builds.forEach((b, i) => {
  b.id = 48210 + i;
  const day = new Date(b.start).toISOString().slice(0, 10).replace(/-/g, "");
  const key = `${b.pipeline.id}|${day}`;
  const n = (perDayCount.get(key) ?? 0) + 1;
  perDayCount.set(key, n);
  b.number = `${day}.${n}`;
});

const byId = new Map(builds.map((b) => [b.id, b]));
const commitDates = new Map(builds.map((b) => [b.commits[b.commits.length - 1], b.commitDate]));
const prsByCommit = {
  merged: new Map(builds.map((b) => [b.commits[b.commits.length - 1], b.merged])),
  produced: new Map(builds.map((b) => [b.commits[b.commits.length - 1], b.produced])),
};

// ── Leases: one per lease-backed production delivery, plus a few older than the window ──
let nextLease = 3300;
const leases: any[] = builds
  .filter((b) => b.leaseAt)
  .map((b) => ({
    leaseId: nextLease++,
    runId: b.id,
    definitionId: b.pipeline.id,
    ownerId: OWNER_ID,
    protectPipeline: false,
    createdOn: new Date(b.leaseAt!),
    validUntil: new Date(b.leaseAt! + 1000 * DAY),
  }));
for (let i = 0; i < 14; i++) {
  const createdOn = now - (92 + i * 2.5) * DAY;
  leases.push({
    leaseId: nextLease++,
    runId: 31000 + i,
    definitionId: pipelines[i % 5].id,
    ownerId: OWNER_ID,
    protectPipeline: false,
    createdOn: new Date(createdOn),
    validUntil: new Date(createdOn + 1000 * DAY),
  });
}

// ── Services and storage ──────────────────────────────────────────────────────
const people = [
  ["alex.morgan@contoso.com", "Alex Morgan", true, SAMPLE_USER_ID],
  ["priya.shah@contoso.com", "Priya Shah", true, guid()],
  ["tom.ellis@contoso.com", "Tom Ellis", false, guid()],
  ["maria.lopez@contoso.com", "Maria Lopez", false, guid()],
  ["sam.okafor@contoso.com", "Sam Okafor", false, undefined],
  ["chen.wei@contoso.com", "Chen Wei", false, undefined],
  ["ruth.adams@contoso.com", "Ruth Adams", false, undefined],
] as const;

const extensionData = extensionDataService({
  "delivery-insights-acl": {
    [`acl.${PROJECT_ID}`]: {
      schemaVersion: 1,
      claimNonce: "demo-claim",
      claimedAt: new Date(now - 120 * DAY).toISOString(),
      entries: people.map(([email, displayName, isAdmin, userId], i) => ({
        email,
        displayName: userId ? displayName : undefined,
        userId,
        isAdmin,
        addedBy: i === 0 ? email : "alex.morgan@contoso.com",
        addedOn: new Date(now - (120 - i * 9) * DAY).toISOString(),
      })),
    },
  },
  "delivery-insights-settings": {
    [`settings.${PROJECT_ID}`]: { excludedPipelines: [EXCLUDED] },
  },
});

export const services: Record<string, unknown> = {
  [CommonServiceIds.ProjectPageService]: projectPageService("Contoso"),
  [CommonServiceIds.ExtensionDataService]: extensionData,
  [CommonServiceIds.LocationService]: {
    getServiceLocation: () => Promise.resolve("https://dev.azure.com/contoso/"),
  },
  [CommonServiceIds.HostNavigationService]: { openNewWindow: () => undefined },
};

// ── REST clients ──────────────────────────────────────────────────────────────
const timelineOf = (b: PlannedBuild) => ({
  id: guid(),
  records: b.stages.map((s) => ({
    type: "Stage",
    id: `${b.id}-${s.name}-${s.attempt}`,
    identifier: s.name,
    name: s.name,
    attempt: s.attempt,
    state: 2,
    result: s.result,
    startTime: s.start === null ? null : new Date(s.start),
    finishTime: s.finish === null ? null : new Date(s.finish),
  })),
});

const asBuild = (b: PlannedBuild) => ({
  id: b.id,
  buildNumber: b.number,
  status: 2,
  result: b.outcome === "qaFail" || b.outcome === "prodFail" ? 8 : 2,
  definition: { id: b.pipeline.id, name: b.pipeline.name },
  sourceBranch: "refs/heads/main",
  repository: { id: b.pipeline.repoId, type: "TfsGit" },
  queueTime: new Date(b.start - MIN),
  startTime: new Date(b.start),
  finishTime: new Date(b.finish),
});

export const getClient = clientFactory({
  BuildRestClient: {
    getDefinitions: () =>
      delay([...pipelines, { id: EXCLUDED.definitionId, name: EXCLUDED.name }].map(({ id, name }) => ({ id, name })), 120),
    getBuilds: (_project: string, definitions: number[], _q: unknown, _n: unknown, from: Date, to: Date) =>
      delay(
        builds
          .filter(
            (b) =>
              definitions.includes(b.pipeline.id) &&
              b.finish >= from.getTime() &&
              b.finish <= to.getTime()
          )
          .sort((a, b) => b.finish - a.finish)
          .map(asBuild),
        150
      ),
    getBuildTimeline: (_project: string, buildId: number) => {
      const b = byId.get(buildId);
      return b ? delay(timelineOf(b), 30) : Promise.reject(new Error("Timeline not found"));
    },
    getBuildChanges: (_project: string, buildId: number) =>
      delay((byId.get(buildId)?.commits ?? []).map((id) => ({ id })), 20),
    getRetentionLeasesByOwnerId: (_project: string, ownerId: string) =>
      delay(leases.filter((l) => l.ownerId === ownerId), 100),
  },
  GitRestClient: {
    getCommit: (commitId: string) => {
      const date = commitDates.get(commitId.toLowerCase());
      return date === undefined
        ? Promise.reject({ status: 404, message: "Commit not found" })
        : delay({ commitId, committer: { date: new Date(date) } }, 20);
    },
    getPullRequestQuery: (body: { queries: { items: string[]; type: number }[] }) => {
      const { items, type } = body.queries[0];
      const source = type === 1 ? prsByCommit.produced : prsByCommit.merged;
      const results: Record<string, any[]> = {};
      for (const id of items) {
        const found = source.get(id);
        if (found?.length) results[id] = found;
      }
      return delay({ results: [results] }, 120);
    },
    getRefs: (repoId: string) => {
      const flow = pipelines.find((p) => p.repoId === repoId)?.flow;
      const branches = ["main", "feature/retry-policy", "feature/audit-log"];
      if (flow === "noff" || flow === "squash") branches.splice(1, 0, "develop");
      return delay(branches.map((name) => ({ name: `refs/heads/${name}` })), 60);
    },
  },
});

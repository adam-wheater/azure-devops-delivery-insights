import { ConcurrencyLimiter } from "@/utils/ConcurrencyLimiter";

const tick = (ms = 0) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe("ConcurrencyLimiter", () => {
  it("never exceeds the configured concurrency", async () => {
    const limiter = new ConcurrencyLimiter(3);
    let active = 0;
    let peak = 0;

    await Promise.all(
      Array.from({ length: 40 }, () =>
        limiter.run(async () => {
          active++;
          peak = Math.max(peak, active);
          await tick(1);
          active--;
        })
      )
    );

    expect(peak).toBeLessThanOrEqual(3);
    expect(limiter.running).toBe(0);
    expect(limiter.queued).toBe(0);
  });

  it("frees a slot when a task rejects", async () => {
    const limiter = new ConcurrencyLimiter(2);
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) =>
        limiter.run(async () => {
          await tick(1);
          if (i % 3 === 0) throw new Error("boom");
          return i;
        })
      )
    );

    expect(results.filter((r) => r.status === "rejected").length).toBeGreaterThan(0);
    expect(limiter.running).toBe(0);
    expect(limiter.queued).toBe(0);
  });

  it("runs every task exactly once", async () => {
    const limiter = new ConcurrencyLimiter(4);
    const seen: number[] = [];
    await Promise.all(
      Array.from({ length: 50 }, (_, i) =>
        limiter.run(async () => {
          await tick(1);
          seen.push(i);
        })
      )
    );
    expect(seen).toHaveLength(50);
    expect(new Set(seen).size).toBe(50);
  });

  it("drain stops queued work from ever starting", async () => {
    const limiter = new ConcurrencyLimiter(2);
    let started = 0;

    const tasks = Array.from({ length: 30 }, () =>
      limiter.run(async () => {
        started++;
        await tick(5);
      })
    );

    // Let the first slots fill, then cancel.
    await tick(1);
    limiter.drain("Cancelled");

    const results = await Promise.allSettled(tasks);
    const rejected = results.filter(
      (r) => r.status === "rejected" && (r.reason as Error).message === "Cancelled"
    );

    expect(rejected.length).toBeGreaterThan(0);
    // Only the tasks admitted before the drain ever ran.
    expect(started).toBeLessThanOrEqual(4);
  });

  it("rejects new work submitted after a drain", async () => {
    const limiter = new ConcurrencyLimiter(1);
    limiter.drain("Cancelled");
    await expect(limiter.run(async () => "nope")).rejects.toThrow("Cancelled");
  });

  it("drains a large queue without leaking waiters", async () => {
    const limiter = new ConcurrencyLimiter(8);
    await Promise.all(Array.from({ length: 500 }, () => limiter.run(async () => undefined)));
    expect(limiter.queued).toBe(0);
    expect(limiter.running).toBe(0);
  });
});

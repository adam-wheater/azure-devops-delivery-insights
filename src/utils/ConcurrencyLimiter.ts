/**
 * Bounded-concurrency task runner.
 *
 * The core semantics are unchanged and correct: a rejected task still frees its slot
 * because the release happens in `finally`.
 *
 * Two additions:
 *  - the wake queue uses a head cursor instead of Array.prototype.shift(), which is
 *    O(n) and dominates once thousands of tasks are queued at once;
 *  - `drain()` empties the queue and makes every waiter throw immediately. Since no
 *    Azure DevOps SDK method accepts an AbortSignal, stopping queued work from ever
 *    starting is the only real cancellation available.
 */
export class ConcurrencyLimiter {
  private active = 0;
  private queue: (() => void)[] = [];
  private head = 0;
  private drained = false;
  private drainReason = "Cancelled";

  constructor(private readonly maxConcurrency: number) {}

  get running(): number {
    return this.active;
  }

  get queued(): number {
    return this.queue.length - this.head;
  }

  async run<T>(fn: () => Promise<T>): Promise<T> {
    while (this.active >= this.maxConcurrency) {
      if (this.drained) throw new Error(this.drainReason);
      await new Promise<void>((resolve) => this.push(resolve));
      if (this.drained) throw new Error(this.drainReason);
    }

    if (this.drained) throw new Error(this.drainReason);

    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.wakeNext();
    }
  }

  /** Stop admitting queued work. In-flight requests cannot be cancelled — the SDK has no signal support. */
  drain(reason = "Cancelled"): void {
    this.drained = true;
    this.drainReason = reason;
    const waiters = this.queue.slice(this.head);
    this.queue = [];
    this.head = 0;
    for (const wake of waiters) wake();
  }

  private push(resolve: () => void): void {
    this.queue.push(resolve);
  }

  private wakeNext(): void {
    if (this.head >= this.queue.length) return;
    const next = this.queue[this.head];
    this.queue[this.head] = undefined as unknown as () => void;
    this.head++;

    // Compact once the consumed prefix dominates, so memory does not grow unbounded.
    if (this.head > 64 && this.head * 2 >= this.queue.length) {
      this.queue = this.queue.slice(this.head);
      this.head = 0;
    }

    next();
  }
}

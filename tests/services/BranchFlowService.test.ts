import {
  fetchPullRequestIndex,
  probeIntegrationBranch,
  COMMIT_BATCH_SIZE,
} from "@/services/BranchFlowService";
import { DEFAULT_INTEGRATION_PATTERNS } from "@/models/interfaces";

function commitIds(count: number, prefix = "c"): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}${i}`);
}

describe("fetchPullRequestIndex", () => {
  it("issues ONE request per query type per batch, not one per commit", () => {
    // This is the whole reason the phase exists. A per-commit implementation is
    // ~8x more requests per delivery and is what trips throttling.
    const getPullRequestQuery = jest.fn().mockResolvedValue({ results: [{}] });

    return fetchPullRequestIndex({ getPullRequestQuery }, "Payments", "repo-1", commitIds(40)).then(
      () => {
        // Two types, one batch.
        expect(getPullRequestQuery).toHaveBeenCalledTimes(2);
        const [body, repositoryId, project] = getPullRequestQuery.mock.calls[0];
        // Parameter order trap: body FIRST, repository id second.
        expect(repositoryId).toBe("repo-1");
        expect(project).toBe("Payments");
        expect(body.queries[0].items).toHaveLength(40);
      }
    );
  });

  it("sends both query types, because neither alone covers every merge strategy", async () => {
    const getPullRequestQuery = jest.fn().mockResolvedValue({ results: [{}] });
    await fetchPullRequestIndex({ getPullRequestQuery }, "P", "repo-1", ["a"]);

    const types = getPullRequestQuery.mock.calls.map((call) => call[0].queries[0].type).sort();
    // 1 = LastMergeCommit (which pull request PRODUCED this commit — squash),
    // 2 = Commit (which pull requests MERGED this commit).
    expect(types).toEqual([1, 2]);
  });

  it("splits commits into batches at the self-imposed cap", async () => {
    const getPullRequestQuery = jest.fn().mockResolvedValue({ results: [{}] });
    await fetchPullRequestIndex(
      { getPullRequestQuery },
      "P",
      "repo-1",
      commitIds(COMMIT_BATCH_SIZE + 1)
    );

    // Two batches, two query types.
    expect(getPullRequestQuery).toHaveBeenCalledTimes(4);
    const sizes = getPullRequestQuery.mock.calls.map((call) => call[0].queries[0].items.length);
    expect(sizes).toEqual([COMMIT_BATCH_SIZE, COMMIT_BATCH_SIZE, 1, 1]);
  });

  it("halves and retries when the server rejects a batch, keeping what succeeds", async () => {
    // No batch limit is documented anywhere in the installed package, so the cap
    // is a guess. A rejection must degrade to smaller requests, not to no data.
    const getPullRequestQuery = jest.fn().mockImplementation((body: any) => {
      if (body.queries[0].items.length > 20) return Promise.reject(new Error("too large"));
      return Promise.resolve({ results: [{ [body.queries[0].items[0]]: [{ pullRequestId: 7 }] }] });
    });

    const index = await fetchPullRequestIndex(
      { getPullRequestQuery },
      "P",
      "repo-1",
      commitIds(40)
    );

    expect(index.failed).toBe(false);
    expect(index.mergedBy.size).toBeGreaterThan(0);
  });

  it("gives up below the split floor and reports the failure rather than pretending", async () => {
    const getPullRequestQuery = jest.fn().mockRejectedValue(new Error("boom"));
    const index = await fetchPullRequestIndex({ getPullRequestQuery }, "P", "repo-1", ["a", "b"]);

    expect(index.failed).toBe(true);
    expect(index.mergedBy.size).toBe(0);
  });

  it("normalises commit id case, so a server that returns uppercase still matches", async () => {
    const getPullRequestQuery = jest
      .fn()
      .mockImplementation((body: any) =>
        Promise.resolve(
          body.queries[0].type === 2
            ? { results: [{ ABCDEF: [{ pullRequestId: 1 }] }] }
            : { results: [{}] }
        )
      );

    const index = await fetchPullRequestIndex({ getPullRequestQuery }, "P", "repo-1", ["abcdef"]);
    expect(index.mergedBy.get("abcdef")).toHaveLength(1);
  });

  it("deduplicates commits so the same sha is never queried twice", async () => {
    const getPullRequestQuery = jest.fn().mockResolvedValue({ results: [{}] });
    await fetchPullRequestIndex({ getPullRequestQuery }, "P", "repo-1", ["a", "A", "a", "b"]);

    expect(getPullRequestQuery.mock.calls[0][0].queries[0].items).toEqual(["a", "b"]);
  });

  it("does no work at all for an empty commit list", async () => {
    const getPullRequestQuery = jest.fn();
    const index = await fetchPullRequestIndex({ getPullRequestQuery }, "P", "repo-1", []);

    expect(getPullRequestQuery).not.toHaveBeenCalled();
    expect(index.failed).toBe(false);
  });

  it("propagates cancellation instead of swallowing it", async () => {
    const controller = new AbortController();
    controller.abort();
    const getPullRequestQuery = jest.fn();

    await expect(
      fetchPullRequestIndex({ getPullRequestQuery }, "P", "repo-1", ["a"], controller.signal)
    ).rejects.toThrow("Cancelled");
    expect(getPullRequestQuery).not.toHaveBeenCalled();
  });
});

describe("probeIntegrationBranch", () => {
  it("proves an integration branch exists", async () => {
    const getRefs = jest
      .fn()
      .mockResolvedValue([{ name: "refs/heads/main" }, { name: "refs/heads/develop" }]);

    await expect(
      probeIntegrationBranch({ getRefs }, "P", "repo-1", DEFAULT_INTEGRATION_PATTERNS)
    ).resolves.toBe(true);
    // getRefs(repositoryId, project, filter) — repository first, filter third.
    expect(getRefs).toHaveBeenCalledWith("repo-1", "P", "heads/");
  });

  it("proves an integration branch does NOT exist, which is what makes the hop absent", async () => {
    const getRefs = jest.fn().mockResolvedValue([{ name: "refs/heads/main" }]);
    await expect(
      probeIntegrationBranch({ getRefs }, "P", "repo-1", DEFAULT_INTEGRATION_PATTERNS)
    ).resolves.toBe(false);
  });

  it("returns unknown, never absence, when the probe itself fails", async () => {
    // Reporting a failed probe as "no develop branch" would silently turn every
    // gitflow repository into a trunk-based one during an outage.
    const getRefs = jest.fn().mockRejectedValue(new Error("403"));
    await expect(
      probeIntegrationBranch({ getRefs }, "P", "repo-1", DEFAULT_INTEGRATION_PATTERNS)
    ).resolves.toBeNull();
  });

  it("returns unknown when the response is not a list of refs", async () => {
    const getRefs = jest.fn().mockResolvedValue(undefined);
    await expect(
      probeIntegrationBranch({ getRefs }, "P", "repo-1", DEFAULT_INTEGRATION_PATTERNS)
    ).resolves.toBeNull();
  });
});

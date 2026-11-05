import {
  classify,
  describeFailure,
  isNotFound,
  ExtensionDataError,
} from "@/services/extensionDataErrors";
import { indexLeases } from "@/services/ProductionSignalService";

describe("classify", () => {
  it("treats a connectivity failure as transient, not missing", () => {
    // XDM rebuilds rejections as plain objects, so this is duck-typed on purpose.
    const err = { name: "NetworkException", message: "TF400893: Unable to contact the server." };
    expect(classify(err).kind).toBe("transient");
    expect(isNotFound(err)).toBe(false);
  });

  it("treats an error with no numeric status as transient", () => {
    // This is the rule that stops a blip reading as "no access list exists",
    // which would let a second user wrongly claim ownership.
    expect(classify({ message: "something odd" }).kind).toBe("transient");
    expect(classify(undefined).kind).toBe("transient");
    expect(classify("boom").kind).toBe("transient");
  });

  it("maps 404 to not-found", () => {
    expect(classify({ status: 404, message: "not found" }).kind).toBe("not-found");
    expect(isNotFound({ status: 404 })).toBe(true);
  });

  it("maps 403 to denied", () => {
    expect(classify({ status: 403 }).kind).toBe("denied");
  });

  it("maps 401 to transient, not denied — it is an expired session, not a permissions problem", () => {
    // A hub left open for hours outlives its access token. Calling that "denied"
    // sends the user to an org admin for something no admin can fix.
    const classified = classify({ status: 401 });
    expect(classified.kind).toBe("transient");
    expect(classified.status).toBe(401);
    expect(describeFailure(classified)).toMatch(/session expired/i);
  });

  it("describes 403 as an authorisation problem rather than an expired session", () => {
    const copy = describeFailure(classify({ status: 403 }));
    expect(copy).toMatch(/403/);
    expect(copy).not.toMatch(/session expired/i);
    // "ask an admin to re-approve" is useless to the person who IS the admin unless
    // it says where to go, and it must not be mistaken for a project permission.
    expect(copy).toMatch(/Organization settings/i);
    expect(copy).toMatch(/not your project permissions/i);
  });

  it("maps throttling and server errors to transient", () => {
    for (const status of [408, 429, 500, 503]) {
      expect(classify({ status }).kind).toBe("transient");
    }
  });

  it("maps other client errors to unknown", () => {
    expect(classify({ status: 400 }).kind).toBe("unknown");
  });

  it("passes an already-classified error straight through", () => {
    const original = new ExtensionDataError("denied", "nope", null, 403);
    expect(classify(original)).toBe(original);
  });

  it("does not rely on instanceof Error", () => {
    const plain = Object.create(null) as Record<string, unknown>;
    plain.status = 404;
    expect(classify(plain).kind).toBe("not-found");
  });
});

describe("indexLeases", () => {
  const lease = (runId: number, createdOn: string, definitionId = 3) => ({
    runId,
    definitionId,
    leaseId: runId,
    ownerId: "Released to PRD",
    protectPipeline: false,
    createdOn: new Date(createdOn),
    validUntil: new Date("2027-01-01T00:00:00Z"),
  });

  it("joins leases to builds by runId", () => {
    const result = indexLeases([lease(11, "2024-05-01T10:00:00Z")]);
    expect(result.byBuildId.get(11)?.buildId).toBe(11);
    expect(result.total).toBe(1);
  });

  it("keeps the earliest release when a build is leased more than once", () => {
    const result = indexLeases([
      lease(11, "2024-06-01T10:00:00Z"),
      lease(11, "2024-05-01T10:00:00Z"),
    ]);
    expect(result.byBuildId.size).toBe(1);
    expect(result.byBuildId.get(11)?.releasedOn).toEqual(new Date("2024-05-01T10:00:00Z"));
    expect(result.total).toBe(2);
  });

  it("reports the oldest release for the expiry caveat", () => {
    const result = indexLeases([
      lease(11, "2024-06-01T10:00:00Z"),
      lease(12, "2023-01-15T10:00:00Z"),
    ]);
    expect(result.oldestReleasedOn).toEqual(new Date("2023-01-15T10:00:00Z"));
  });

  it("accepts ISO strings as well as Date objects", () => {
    const result = indexLeases([
      { ...lease(11, "2024-05-01T10:00:00Z"), createdOn: "2024-05-01T10:00:00Z" },
    ]);
    expect(result.byBuildId.get(11)?.releasedOn).toEqual(new Date("2024-05-01T10:00:00Z"));
  });

  it("skips malformed leases instead of producing invalid dates", () => {
    const result = indexLeases([
      { runId: undefined, createdOn: new Date() },
      { runId: 5, createdOn: "not-a-date" },
      lease(11, "2024-05-01T10:00:00Z"),
    ]);
    expect(result.byBuildId.size).toBe(1);
    expect(result.byBuildId.has(11)).toBe(true);
  });
});

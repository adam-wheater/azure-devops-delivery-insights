import {
  buildEmailCandidates,
  initialsFor,
  normalizeEmail,
  unmangleGuestUpn,
} from "@/services/identity";

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Adam.Wheater@Company.COM ")).toBe("adam.wheater@company.com");
  });

  it("returns an empty string for null-ish input", () => {
    expect(normalizeEmail(null)).toBe("");
    expect(normalizeEmail(undefined)).toBe("");
  });
});

describe("unmangleGuestUpn", () => {
  it("recovers the real address from an AAD B2B guest UPN", () => {
    expect(unmangleGuestUpn("adam_contoso.com#ext#@fabrikam.onmicrosoft.com")).toEqual([
      "adam@contoso.com",
    ]);
  });

  it("splits on the LAST underscore so a dotted local part survives", () => {
    expect(unmangleGuestUpn("adam.wheater_contoso.com#ext#@fabrikam.onmicrosoft.com")).toEqual([
      "adam.wheater@contoso.com",
    ]);
  });

  it("returns nothing for an ordinary address", () => {
    expect(unmangleGuestUpn("adam@contoso.com")).toEqual([]);
  });

  it("returns nothing when the marker is present but unusable", () => {
    expect(unmangleGuestUpn("_contoso.com#ext#@fabrikam.onmicrosoft.com")).toEqual([]);
    expect(unmangleGuestUpn("adam_#ext#@fabrikam.onmicrosoft.com")).toEqual([]);
  });
});

describe("buildEmailCandidates", () => {
  it("includes the normalized address", () => {
    expect(buildEmailCandidates("Adam@Contoso.com")).toEqual(["adam@contoso.com"]);
  });

  it("includes both the raw guest UPN and the recovered address", () => {
    const candidates = buildEmailCandidates("Adam_Contoso.com#EXT#@fabrikam.onmicrosoft.com");
    expect(candidates).toContain("adam_contoso.com#ext#@fabrikam.onmicrosoft.com");
    expect(candidates).toContain("adam@contoso.com");
  });

  it("produces no candidates for an empty name", () => {
    expect(buildEmailCandidates("")).toEqual([]);
  });

  it("does not duplicate entries", () => {
    const candidates = buildEmailCandidates("adam@contoso.com");
    expect(new Set(candidates).size).toBe(candidates.length);
  });
});

describe("initialsFor", () => {
  it("uses the first letters of a display name", () => {
    expect(initialsFor({ displayName: "Adam Wheater", email: "a@b.com" })).toBe("AW");
  });

  it("falls back to the email when there is no display name", () => {
    expect(initialsFor({ displayName: "", email: "adam.wheater@contoso.com" })).toBe("AW");
  });

  it("handles a single-word name", () => {
    expect(initialsFor({ displayName: "Adam", email: "a@b.com" })).toBe("AD");
  });
});

import * as React from "react";
import { render, screen, waitFor, act } from "@testing-library/react";
import "@testing-library/jest-dom";

const evaluate = jest.fn();
const claimOwnership = jest.fn();

jest.mock("@/services/AccessControlService", () => ({
  AccessControlService: class {
    evaluate = evaluate;
    claimOwnership = claimOwnership;
  },
}));

import { AccessGate, useAccess } from "@/components/AccessGate";
// Imported by path, not by package name: the package name resolves to the real
// typings at compile time, while jest's moduleNameMapper points it at this same
// file at runtime — so both refer to one module instance.
import { __setMockUser } from "../__mocks__/azure-devops-extension-sdk";

const grantedDecision = {
  state: "granted" as const,
  isAdmin: true,
  entry: {
    email: "adam@contoso.com",
    userId: "user-1",
    isAdmin: true,
    addedBy: "adam@contoso.com",
    addedOn: "2024-01-01T00:00:00Z",
  },
  doc: {
    id: "acl.p1",
    schemaVersion: 1 as const,
    claimNonce: "n",
    claimedAt: "2024-01-01T00:00:00Z",
    entries: [],
  },
};

let mountCount = 0;
let triggerRefresh: () => void = () => undefined;

const GatedChild: React.FC = () => {
  const { refresh } = useAccess();
  triggerRefresh = refresh;
  React.useEffect(() => {
    mountCount++;
  }, []);
  return <div data-testid="dashboard">dashboard</div>;
};

function renderGate() {
  return render(
    <AccessGate projectId="p1" projectName="Payments">
      <GatedChild />
    </AccessGate>
  );
}

beforeEach(() => {
  __setMockUser({ name: "adam@contoso.com", displayName: "Adam Wheater" });
  mountCount = 0;
  evaluate.mockReset();
  claimOwnership.mockReset();
});

describe("AccessGate", () => {
  it("renders the gated children once access is granted", async () => {
    evaluate.mockResolvedValue(grantedDecision);
    renderGate();
    expect(await screen.findByTestId("dashboard")).toBeInTheDocument();
    expect(mountCount).toBe(1);
  });

  it("keeps the dashboard mounted while re-validating an already-granted decision", async () => {
    // Regression: refresh() used to reset the gate to "loading", unmounting
    // children — so every access grant closed the admin modal and blanked the
    // dashboard, discarding the loaded analysis with it.
    let resolveSecond: (value: unknown) => void = () => undefined;
    evaluate
      .mockResolvedValueOnce(grantedDecision)
      .mockImplementationOnce(() => new Promise((resolve) => (resolveSecond = resolve)));

    renderGate();
    await screen.findByTestId("dashboard");
    expect(mountCount).toBe(1);

    act(() => triggerRefresh());

    // Still mounted while the second evaluate() is in flight.
    expect(screen.getByTestId("dashboard")).toBeInTheDocument();

    await act(async () => {
      resolveSecond(grantedDecision);
    });

    expect(screen.getByTestId("dashboard")).toBeInTheDocument();
    expect(mountCount).toBe(1);
  });

  it("shows the locked screen with the exact sign-in name when access is denied", async () => {
    // An AAD B2B guest: the resource-tenant UPN differs from the address an admin
    // would naturally type, which is precisely why the raw string is displayed.
    __setMockUser({ name: "Adam_Contoso.com#EXT#@fabrikam.onmicrosoft.com" });
    evaluate.mockResolvedValue({
      state: "denied",
      rawName: "Adam_Contoso.com#EXT#@fabrikam.onmicrosoft.com",
      candidates: ["adam_contoso.com#ext#@fabrikam.onmicrosoft.com", "adam@contoso.com"],
      admins: ["boss@contoso.com"],
    });

    renderGate();

    expect(await screen.findByText(/don't have access yet/i)).toBeInTheDocument();
    // The raw string must be shown verbatim so a mismatch is self-fixable.
    expect(screen.getByText("Adam_Contoso.com#EXT#@fabrikam.onmicrosoft.com")).toBeInTheDocument();
    // The un-mangled guest address is listed as something we also matched against,
    // so an admin can see which string to add. (The diagnostics block repeats it,
    // hence the scoped query rather than a bare text match.)
    expect(screen.getByText(/We also tried/i)).toHaveTextContent("adam@contoso.com");
    expect(screen.queryByTestId("dashboard")).not.toBeInTheDocument();
  });

  it("never offers the claim screen when the access check failed transiently", async () => {
    // Showing "claim ownership" during an outage is how a bystander would take over.
    evaluate.mockResolvedValue({
      state: "error",
      kind: "transient",
      message: "Could not reach Azure DevOps.",
    });

    renderGate();

    expect(await screen.findByText(/couldn't check access/i)).toBeInTheDocument();
    expect(screen.queryByText(/claim ownership/i)).not.toBeInTheDocument();
    expect(screen.queryByTestId("dashboard")).not.toBeInTheDocument();
  });

  it("offers the claim screen only when the list genuinely does not exist", async () => {
    evaluate.mockResolvedValue({ state: "unclaimed" });
    renderGate();
    expect(await screen.findByRole("button", { name: /claim ownership/i })).toBeInTheDocument();
  });

  it("does not grant access when the claim is lost to a concurrent user", async () => {
    evaluate.mockResolvedValue({ state: "unclaimed" });
    claimOwnership.mockResolvedValue({ outcome: "lost", doc: grantedDecision.doc });

    renderGate();
    const claim = await screen.findByRole("button", { name: /claim ownership/i });

    await act(async () => {
      claim.click();
    });

    await waitFor(() =>
      expect(screen.getByText(/someone else claimed this dashboard first/i)).toBeInTheDocument()
    );
  });
});

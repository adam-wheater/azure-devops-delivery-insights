// Mock for azure-devops-extension-sdk
const mockServices: Record<string, any> = {};
let mockAccessToken: string = "mock-access-token";
const mockExtensionContext = { id: "mock-extension-id" };

export function getService<T>(serviceId: string): Promise<T> {
  return Promise.resolve(mockServices[serviceId] as T);
}

export function getAccessToken(): Promise<string> {
  return Promise.resolve(mockAccessToken);
}

export function getExtensionContext(): { id: string } {
  return mockExtensionContext;
}

let mockUser = {
  id: "user-1",
  name: "adam@contoso.com",
  displayName: "Adam Wheater",
  descriptor: "aad.YWJjZA",
  imageUrl: "",
};

export function getUser(): typeof mockUser {
  return mockUser;
}

export function getHost() {
  return {
    id: "host-1",
    name: "contoso",
    serviceVersion: "Dev18.M000",
    type: 4,
    isHosted: true,
  };
}

export function __setMockUser(user: Partial<typeof mockUser>): void {
  mockUser = { ...mockUser, ...user };
}

export function init(): Promise<void> {
  return Promise.resolve();
}

export function ready(): Promise<void> {
  return Promise.resolve();
}

// Test helpers
export function __setMockService(serviceId: string, service: any): void {
  mockServices[serviceId] = service;
}

export function __resetMockServices(): void {
  for (const key of Object.keys(mockServices)) {
    delete mockServices[key];
  }
}

/** The host can resolve getAccessToken() with an empty string rather than rejecting. */
export function __setMockAccessToken(token: string): void {
  mockAccessToken = token;
}

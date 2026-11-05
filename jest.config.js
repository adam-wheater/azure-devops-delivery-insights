const moduleNameMapper = {
  "^@/(.*)$": "<rootDir>/src/$1",
  "\\.css$": "<rootDir>/tests/__mocks__/styleMock.js",
  "^azure-devops-extension-api(.*)$": "<rootDir>/tests/__mocks__/azure-devops-extension-api.ts",
  "^azure-devops-extension-sdk$": "<rootDir>/tests/__mocks__/azure-devops-extension-sdk.ts",
};

module.exports = {
  coverageDirectory: "coverage",
  collectCoverageFrom: ["src/**/*.ts", "src/**/*.tsx", "!src/DeliveryInsightsHub/**"],
  projects: [
    {
      displayName: "unit",
      preset: "ts-jest",
      testEnvironment: "node",
      roots: ["<rootDir>/tests"],
      testPathIgnorePatterns: ["<rootDir>/tests/components/"],
      moduleNameMapper,
    },
    {
      displayName: "components",
      preset: "ts-jest",
      testEnvironment: "jsdom",
      roots: ["<rootDir>/tests/components"],
      moduleNameMapper,
    },
  ],
};

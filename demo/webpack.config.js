const path = require("path");
const base = require("../webpack.config.js");

// Builds the hub against demo/sdk.ts and demo/api.ts instead of Azure DevOps, so
// the real UI runs in a plain browser on sample data. Used for the README and
// Marketplace screenshots (`npm run screenshots`); nothing here ships.
module.exports = (env, argv) => {
  const config = base(env, { ...argv, mode: "development" });
  config.mode = "development";
  config.devtool = false;
  config.output.path = path.resolve(__dirname, "dist");
  config.resolve.alias = {
    ...config.resolve.alias,
    "azure-devops-extension-sdk$": path.resolve(__dirname, "sdk.ts"),
    "azure-devops-extension-api$": path.resolve(__dirname, "api.ts"),
  };
  delete config.resolve.alias["azure-devops-extension-sdk"];
  // demo/ sits outside tsconfig's rootDir; type checking is the main build's job.
  config.module.rules = config.module.rules.map((rule) =>
    rule.use === "ts-loader"
      ? { ...rule, use: { loader: "ts-loader", options: { transpileOnly: true } } }
      : rule
  );
  return config;
};

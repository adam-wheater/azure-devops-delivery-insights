const path = require("path");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const MiniCssExtractPlugin = require("mini-css-extract-plugin");
const CssMinimizerPlugin = require("css-minimizer-webpack-plugin");

// The single hub this extension contributes. The HTML page is copied verbatim
// and references `<HUB>.js` and `<HUB>.css` by hand, so output names here must
// stay stable (no content hashes) and nested chunks must land in the same folder.
// scripts/verify-bundle.js reads this constant.
const HUB = "DeliveryInsightsHub";

module.exports = (env, argv) => {
  const isProd = argv.mode === "production";
  return {
    entry: {
      [HUB]: `./src/${HUB}/${HUB}.tsx`,
    },
    output: {
      filename: "[name]/[name].js",
      // Lazy chunks MUST be emitted into the same directory as the entry script.
      // publicPath "auto" resolves them relative to the running script's URL
      // (dist/<HUB>/), so a nested chunk path would 404 at runtime.
      chunkFilename: `${HUB}/[name].[contenthash:8].js`,
      path: path.resolve(__dirname, "dist"),
      publicPath: "auto",
      clean: true,
    },
    resolve: {
      extensions: [".ts", ".tsx", ".js"],
      alias: {
        "@": path.resolve(__dirname, "src"),
        // Force a single copy of the SDK to prevent "already loaded" warning
        "azure-devops-extension-sdk": path.resolve(
          __dirname,
          "node_modules/azure-devops-extension-sdk"
        ),
      },
    },
    module: {
      rules: [
        {
          test: /\.tsx?$/,
          use: "ts-loader",
          exclude: /node_modules/,
        },
        {
          test: /\.css$/,
          // Extracted in BOTH modes, deliberately: the HTML links <HUB>.css by
          // hand, so a dev build that injected styles via style-loader would
          // emit no such file and hide a production-only styling break.
          use: [MiniCssExtractPlugin.loader, "css-loader"],
        },
      ],
    },
    optimization: isProd
      ? {
          usedExports: true,
          sideEffects: true,
          minimize: true,
          minimizer: ["...", new CssMinimizerPlugin()],
          // Only async chunks are split; the entry stays a single <HUB>.js the
          // page can reference by name.
          splitChunks: {
            chunks: "async",
            cacheGroups: {
              // The ADO REST clients are large and only needed once an analysis
              // starts, so they must not sit in the first-paint bundle.
              adoApi: {
                test: /[\\/]node_modules[\\/]azure-devops-extension-api[\\/]/,
                name: "ado-api",
                priority: 10,
                reuseExistingChunk: true,
              },
            },
          },
        }
      : undefined,
    performance: { hints: false },
    plugins: [
      new CopyWebpackPlugin({
        patterns: [
          {
            from: `src/${HUB}/${HUB}.html`,
            to: `${HUB}/${HUB}.html`,
          },
          // static/ is NOT copied into dist/: the manifest ships the root
          // static/ folder directly and its icon paths resolve there.
        ],
      }),
      new MiniCssExtractPlugin({ filename: "[name]/[name].css" }),
    ],
    devtool: isProd ? false : "source-map",
  };
};

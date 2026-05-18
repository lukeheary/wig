const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const projectRoot = __dirname;
const config = getDefaultConfig(projectRoot);

const mobileNodeModules = path.resolve(projectRoot, "node_modules");
const workspaceNodeModules = path.resolve(projectRoot, "../../node_modules");
const pnpmHoistedNodeModules = path.resolve(
  projectRoot,
  "../../node_modules/.pnpm/node_modules"
);
const expoPackage = path.dirname(
  require.resolve("expo/package.json", { paths: [projectRoot] })
);
const shim = (name) => path.resolve(projectRoot, "shims", `${name}.ts`);

config.resolver.nodeModulesPaths = [
  mobileNodeModules,
  workspaceNodeModules,
  pnpmHoistedNodeModules,
];
config.resolver.disableHierarchicalLookup = true;
config.resolver.extraNodeModules = {
  "@clerk/clerk-expo": shim("clerk-expo"),
  "@expo/metro-runtime": path.resolve(
    pnpmHoistedNodeModules,
    "@expo/metro-runtime"
  ),
  expo: expoPackage,
  "expo-crypto": shim("expo-crypto"),
  "expo-secure-store": shim("expo-secure-store"),
  "expo-web-browser": shim("expo-web-browser"),
  react: path.resolve(mobileNodeModules, "react"),
  "react/jsx-runtime": path.resolve(mobileNodeModules, "react/jsx-runtime"),
  "react/jsx-dev-runtime": path.resolve(
    mobileNodeModules,
    "react/jsx-dev-runtime"
  ),
  "react-native": path.resolve(mobileNodeModules, "react-native"),
};

module.exports = config;

const fs = require("fs");
const path = require("path");

const root = process.cwd();
const target = path.join(
  root,
  "node_modules/.pnpm/@expo+metro-config@0.20.18/node_modules/@expo/metro-config/build/serializer/fork/js.js"
);

if (!fs.existsSync(target)) {
  console.log("patch-expo-metro: target not found, skipping");
  process.exit(0);
}

let source = fs.readFileSync(target, "utf8");

source = source.replace(
  "const bundlePath = path_1.default.relative(options.serverRoot, dependency.absolutePath);",
  "const asyncTargetPath = dependency.absolutePath ?? modulePath;\n                    const bundlePath = path_1.default.relative(options.serverRoot, asyncTargetPath);"
);

source = source.replace(
  "paths[id] = options.computedAsyncModulePaths[dependency.absolutePath];",
  "paths[id] = options.computedAsyncModulePaths[dependency.absolutePath ?? modulePath];"
);

fs.writeFileSync(target, source);
console.log("patch-expo-metro: applied");

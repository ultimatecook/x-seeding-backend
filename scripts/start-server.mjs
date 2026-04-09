/* eslint-env node */
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawn } from "node:child_process";

function resolveServerEntry() {
  const vercelServerDir = "./build/server";
  if (existsSync(vercelServerDir)) {
    const runtimeDir = readdirSync(vercelServerDir).find((name) =>
      name.startsWith("nodejs_"),
    );
    if (runtimeDir) {
      const runtimeEntry = join(vercelServerDir, runtimeDir, "index.js");
      if (existsSync(runtimeEntry)) return runtimeEntry;
    }
  }

  const defaultEntry = "./build/server/index.js";
  if (existsSync(defaultEntry)) return defaultEntry;

  throw new Error(
    "No se encontró servidor compilado. Ejecuta `npm run build` antes de `npm run start`.",
  );
}

const entry = resolveServerEntry();
const child = spawn("react-router-serve", [entry], { stdio: "inherit" });

child.on("exit", (code) => {
  process.exit(code ?? 0);
});

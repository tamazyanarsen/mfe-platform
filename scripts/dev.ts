import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { killTree } from "./kill-tree";

// Поднимает все dev-серверы одной командой; Ctrl+C или падение одного останавливает все.
// Приложения находятся сами: новый ремоут из create:remote подхватывается без правок здесь.
const appsDir = join(import.meta.dir, "..", "apps");
const apps = readdirSync(appsDir)
  .filter((app) => existsSync(join(appsDir, app, "package.json")))
  .sort((a, b) => Number(a === "host") - Number(b === "host"));

const children = apps.map((app) =>
  Bun.spawn(["bun", "run", "dev"], {
    cwd: join(appsDir, app),
    stdout: "inherit",
    stderr: "inherit",
  }),
);

let stopping = false;
const stop = async () => {
  if (stopping) return;
  stopping = true;
  await Promise.all(children.map(killTree));
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);

await Promise.race(children.map((child) => child.exited));
await stop();

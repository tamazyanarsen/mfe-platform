import { killTree } from "./kill-tree";

// Поднимает все dev-серверы одной командой; Ctrl+C или падение одного останавливает все.
const apps = ["mfe-accounts", "mfe-payments", "mfe-legacy-react", "host"];

const children = apps.map((app) =>
  Bun.spawn(["bun", "run", "dev"], {
    cwd: `${import.meta.dir}/../apps/${app}`,
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

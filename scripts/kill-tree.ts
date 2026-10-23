import type { Subprocess } from "bun";

/**
 * Останавливает процесс вместе с потомками. `bun run dev` запускает rsbuild внуком, и на
 * Windows `kill()` гасит только прямого потомка — сервер остаётся занимать порт.
 */
export const killTree = async (child: Subprocess) => {
  if (child.exitCode !== null) return;
  if (process.platform === "win32") {
    Bun.spawnSync(["taskkill", "/pid", String(child.pid), "/T", "/F"], {
      stdout: "ignore",
      stderr: "ignore",
    });
  } else {
    child.kill();
  }
  await child.exited;
};

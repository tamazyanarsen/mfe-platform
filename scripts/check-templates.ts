import { readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { measureRemote } from "./check-size";
import { CONFIG_PATH, createRemote, TEMPLATES } from "./create-remote";

/**
 * Шаблоны ремоутов не должны устаревать молча: каждый генерируется в apps/, ставится,
 * проходит свой тест контракта, собирается и укладывается в свой бюджет размера. После проверки репозиторий возвращается
 * в исходное состояние, даже если что-то упало.
 */
const root = join(import.meta.dir, "..");
const configPath = join(root, CONFIG_PATH);
const config = readFileSync(configPath, "utf8");
const lock = readFileSync(join(root, "bun.lock"), "utf8");
const names = TEMPLATES.map((template) => `tmpl_${template}`);

const run = (cmd: string[], cwd = root) => {
  const result = Bun.spawnSync(cmd, { cwd, stdout: "inherit", stderr: "inherit" });
  if (result.exitCode !== 0) throw new Error(`${cmd.join(" ")} failed in ${cwd}`);
};

let failed = false;
try {
  TEMPLATES.forEach((template, index) => {
    createRemote({ root, name: names[index] as string, template, port: 3900 + index });
  });
  run(["bun", "install"]);
  run(["bun", "test", ...names.map((name) => `apps/mfe-${name}`)]);
  for (const name of names) {
    const dir = join(root, "apps", `mfe-${name}`);
    run(["bun", "run", "build"], dir);
    const size = measureRemote(dir, name);
    if (!size || size.budgetBytes === undefined || size.gzipBytes > size.budgetBytes) {
      throw new Error(
        `${name}: ${((size?.gzipBytes ?? 0) / 1024).toFixed(1)} KB gzip is over its size budget`,
      );
    }
  }
  console.log(`templates ok: ${TEMPLATES.join(", ")}`);
} catch (error) {
  failed = true;
  console.error(`[check-templates] ${(error as Error).message}`);
} finally {
  for (const name of names)
    rmSync(join(root, "apps", `mfe-${name}`), { recursive: true, force: true });
  writeFileSync(configPath, config);
  writeFileSync(join(root, "bun.lock"), lock);
  run(["bun", "install"]);
}
process.exit(failed ? 1 : 0);

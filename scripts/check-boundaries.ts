import { resolve } from "node:path";
import { checkBoundaries } from "./boundaries";

const root = resolve(process.argv[2] ?? ".");
const violations = checkBoundaries(root);

if (violations.length > 0) {
  console.error("Нарушены архитектурные границы:\n");
  for (const { file, specifier, rule } of violations) {
    console.error(`  ${file}: "${specifier}" — ${rule}`);
  }
  process.exit(1);
}
console.log("Границы пакетов в порядке.");

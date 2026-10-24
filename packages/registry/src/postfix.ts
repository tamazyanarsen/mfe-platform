const SEMVER_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/;

/**
 * Соглашение о постфиксе: постфикс — это линия совместимости кита по semver.
 * Для версий от 1.0.0 — мажор: `v2`. Для 0.x ломающим считается минор, поэтому `v0-1`.
 * Ремоуты на совместимых версиях получают один постфикс и один набор тегов.
 *
 * Имя кита в постфикс не входит: оно уже есть в базовом имени тега (`rwc-button`).
 */
export const postfixFor = (_kit: string, version: string): string => {
  const match = SEMVER_RE.exec(version.trim());
  if (!match) throw new Error(`[mfe] "${version}" is not a semver version`);
  const [, major, minor] = match;
  return major === "0" ? `v0-${minor}` : `v${major}`;
};

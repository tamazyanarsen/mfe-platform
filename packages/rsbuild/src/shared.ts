/**
 * Общие модули Module Federation по линиям совместимости.
 *
 * Ремоуты, собранные с совместимыми версиями пакета (`^version`: тот же мажор, для 0.x — тот
 * же минор), получают на странице один его экземпляр. Несовместимые версии не делятся: каждый
 * такой ремоут грузит свою копию, и команды по-прежнему обновляются независимо. Это не
 * singleton — singleton привязал бы все ремоуты к одной версии.
 *
 * UI-кит делится вместе со своим фреймворком: компоненты кита, работающие на чужой копии
 * `@rwcjs/core`, не видели бы реактивность ремоута.
 */
export interface SharedPackage {
  readonly version: string;
  readonly requiredVersion: string;
  readonly singleton: false;
}

export const sharedByLine = (
  packages: Readonly<Record<string, string>>,
): Record<string, SharedPackage> =>
  Object.fromEntries(
    Object.entries(packages).map(([pkg, version]) => [
      pkg,
      { version, requiredVersion: `^${version}`, singleton: false },
    ]),
  );

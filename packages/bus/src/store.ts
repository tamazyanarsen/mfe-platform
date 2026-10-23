/**
 * Общий стор платформы. Живёт в хосте и раздаётся ремоутам свойством их элемента, а не
 * через provide/inject: свойства и события работают при любом фреймворке ремоута и без
 * общего рантайма (Р4, Р6), а provide/inject требует одной копии rwc на всю страницу.
 */
export interface Store<State> {
  get(): State;
  /** Сливает изменения верхнего уровня; равные значения не будят подписчиков. */
  set(patch: Partial<State>): void;
  subscribe(listener: (state: State) => void): () => void;
}

export const createStore = <State extends object>(initial: State): Store<State> => {
  let state = initial;
  const listeners = new Set<(state: State) => void>();
  return {
    get: () => state,
    set(patch) {
      const changed = (Object.keys(patch) as Array<keyof State>).some(
        (key) => !Object.is(state[key], patch[key]),
      );
      if (!changed) return;
      state = { ...state, ...patch };
      for (const listener of [...listeners]) listener(state);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

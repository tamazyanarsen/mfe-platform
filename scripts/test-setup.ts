import { GlobalRegistrator } from "@happy-dom/global-registrator";

// http-адрес, а не about:blank: роутеру хоста нужна рабочая History API.
GlobalRegistrator.register({ url: "http://localhost:3000/" });

// Константы, которые в ремоутах подставляет сборка (config/rsbuild-remote.ts). Тест ремоута
// может выставить свои значения до импорта его модулей.
const scope = globalThis as Record<string, unknown>;
scope.__MFE_REMOTE_VERSION__ ??= "0.0.0-test";
scope.__MFE_KIT_VERSIONS__ ??= {};

// happy-dom не реализует ElementInternals, а формовые компоненты UI-кита вызывают
// attachInternals() в конструкторе. Заглушки хватает, чтобы смонтировать ремоут в unit-тесте;
// поведение форм проверяют e2e в настоящем браузере.
if (!("attachInternals" in HTMLElement.prototype)) {
  Object.defineProperty(HTMLElement.prototype, "attachInternals", {
    configurable: true,
    value(this: HTMLElement) {
      return {
        form: null,
        labels: [],
        states: new Set<string>(),
        validity: { valid: true },
        validationMessage: "",
        willValidate: true,
        setFormValue() {},
        setValidity() {},
        checkValidity: () => true,
        reportValidity: () => true,
      };
    },
  });
}

import type { NavigateDetail, PlatformState } from "@mfe-platform/contract";
import { useState } from "react";

export interface ReportsProps {
  readonly basename?: string;
  readonly platform?: PlatformState | null;
  readonly onNavigate?: (detail: NavigateDetail) => void;
}

const REPORTS = [
  { id: "turnover", title: "Обороты за месяц" },
  { id: "balance", title: "Остатки на конец дня" },
];

/** Обычный React-компонент: о платформе он знает только пропсы и колбэк навигации. */
export const Reports = ({ platform, onNavigate }: ReportsProps) => {
  const [opened, setOpened] = useState<string | null>(null);
  return (
    <section style={{ fontFamily: "system-ui, sans-serif" }}>
      <h2>Отчёты</h2>
      <p data-testid="legacy-stack">Ремоут на React</p>
      <p data-testid="legacy-selected">Счёт: {platform?.selected?.title ?? "не выбран"}</p>
      <ul>
        {REPORTS.map((report) => (
          <li key={report.id}>
            <button type="button" onClick={() => setOpened(report.id)}>
              {report.title}
            </button>
          </li>
        ))}
      </ul>
      {opened && <p data-testid="legacy-opened">Открыт отчёт: {opened}</p>}
      <button type="button" onClick={() => onNavigate?.({ to: "/payments" })}>
        К платежам
      </button>
    </section>
  );
};

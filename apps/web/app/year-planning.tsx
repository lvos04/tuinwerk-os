"use client";

import { useEffect, useState } from "react";

type Row = Record<string, any>;
type Forecast = {
  id: string;
  ruleId: string;
  title: string;
  dueDate: string;
  plannedAt: string;
  taskId: string | null;
  assetId: string | null;
  locationId: string | null;
  tentative: boolean;
  generated: boolean;
};

export function YearPlanning({
  api,
  tasks,
  assets,
  locations,
  openTask,
}: {
  api: (path: string) => Promise<any>;
  tasks: Row[];
  assets: Row[];
  locations: Row[];
  openTask: (task: Row) => Promise<void>;
}) {
  const [year, setYear] = useState(new Date().getFullYear());
  const [forecast, setForecast] = useState<Forecast[]>([]);
  const [assetId, setAssetId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setForecast([]);
    api(`/recurrences/forecast?from=${year}-01-01&to=${year}-12-31`)
      .then((rows: Forecast[]) => {
        if (!cancelled) setForecast(rows);
      })
      .catch((e: Error) => {
        if (!cancelled) setError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [year, revision]);

  const match = (row: Row) =>
    (!assetId || row.assetId === assetId) &&
    (!locationId || row.locationId === locationId);
  const taskIds = new Set(tasks.map((task) => task.id));
  const taskEntries = tasks
    .filter((task) => match(task) && (task.plannedAt || task.deadline))
    .map((task) => ({
      key: task.id,
      title: task.title,
      day: String(task.plannedAt || task.deadline).slice(0, 10),
      task,
      tentative: false,
    }));
  const forecastEntries = forecast
    .filter((row) => match(row) && (!row.taskId || !taskIds.has(row.taskId)))
    .map((row) => ({
      key: row.id,
      title: row.title,
      day: row.dueDate,
      task: row.taskId ? { id: row.taskId, title: row.title } : null,
      tentative: row.tentative,
    }));
  const entries = [...taskEntries, ...forecastEntries]
    .filter((row) => row.day.startsWith(String(year) + "-"))
    .sort(
      (a, b) => a.day.localeCompare(b.day) || a.title.localeCompare(b.title),
    );

  return (
    <>
      <div className="toolbar">
        <label className="field">
          <span>Jaar</span>
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
          >
            {Array.from(
              { length: 11 },
              (_, index) => new Date().getFullYear() - 3 + index,
            ).map((value) => (
              <option value={value} key={value}>
                {value}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Machine</span>
          <select value={assetId} onChange={(e) => setAssetId(e.target.value)}>
            <option value="">Alle machines</option>
            {assets.map((asset) => (
              <option key={asset.id} value={asset.id}>
                {asset.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Locatie</span>
          <select
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
          >
            <option value="">Alle locaties</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </label>
        <button
          className="secondary"
          disabled={loading}
          onClick={() => setRevision((value) => value + 1)}
        >
          Voorspelling vernieuwen
        </button>
      </div>
      <p className="muted">
        Taken zijn bestaande werkopdrachten. Voorspellingen tonen toekomstig
        onderhoud op basis van de huidige regels; hiervoor zijn nog geen taken
        aangemaakt. Bij een interval vanaf uitvoering blijft de voorspelde datum
        afhankelijk van de daadwerkelijke afronding.
      </p>
      {loading && <p role="status">Onderhoud voor {year} berekenen…</p>}
      {error && (
        <div className="alert error" role="alert">
          Voorspelling kon niet worden geladen: {error}. Bestaande taken blijven
          zichtbaar.
        </div>
      )}
      <div className="year-grid">
        {Array.from({ length: 12 }, (_, month) => (
          <section className="panel" key={month}>
            <h3>
              {new Date(year, month, 1).toLocaleDateString("nl-NL", {
                month: "long",
              })}
            </h3>
            {entries
              .filter((row) => Number(row.day.slice(5, 7)) === month + 1)
              .map((row) => {
                const content = (
                  <>
                    <span className="badge">
                      {row.task ? "Taak" : "Voorspelling"}
                    </span>
                    <strong style={{ display: "block", marginTop: 6 }}>
                      {row.day.slice(8, 10)} · {row.title}
                    </strong>
                    {!row.task && row.tentative && (
                      <small>Afhankelijk van uitvoering</small>
                    )}
                  </>
                );
                return row.task ? (
                  <button
                    className="calendar-task"
                    key={row.key}
                    onClick={() => void openTask(row.task!)}
                  >
                    {content}
                  </button>
                ) : (
                  <div
                    className="calendar-task"
                    key={row.key}
                    style={{
                      border: "1px dashed #9aad8c",
                      background: "#f9fbf6",
                    }}
                  >
                    {content}
                  </div>
                );
              })}
          </section>
        ))}
      </div>
    </>
  );
}

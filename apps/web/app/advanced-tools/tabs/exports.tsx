"use client";
import { json, F, options, type Row } from "../ui";
import type { AdvancedToolsState } from "../use-advanced-tools";

export function ExportsTab({ w }: { w: AdvancedToolsState }) {
  const {
    submit,
    api,
    setRows,
    setNotice,
    locations,
    assets,
    busy,
    work,
    rows,
    download,
  } = w;
  return (
    <>
      <form
        onSubmit={(e) =>
          submit(e, async (f) => {
            await api(
              "/reports/jobs",
              json(
                "POST",
                Object.fromEntries([...f.entries()].filter(([, v]) => v)),
              ),
            );
            setRows(await api("/reports/jobs"));
            setNotice(
              "Export staat in de wachtrij. De achtergrondworker verwerkt deze aanvraag.",
            );
          })
        }
      >
        <div className="form-grid">
          <F label="Gegevens">
            <select name="type">
              <option value="tasks">Taken</option>
              <option value="inventory">Voorraad</option>
              <option value="assets">Machines</option>
            </select>
          </F>
          <F label="Formaat">
            <select name="format">
              <option value="xlsx">Excel</option>
              <option value="pdf">PDF</option>
              <option value="csv">CSV</option>
            </select>
          </F>
          <F label="Vanaf">
            <input name="from" type="date" />
          </F>
          <F label="Tot en met">
            <input name="to" type="date" />
          </F>
          <F label="Locatie">
            <select name="locationId">
              <option value="">Alle locaties</option>
              {options(locations)}
            </select>
          </F>
          <F label="Machine">
            <select name="assetId">
              <option value="">Alle machines</option>
              {options(assets)}
            </select>
          </F>
        </div>
        <button className="primary" disabled={busy}>
          Export aanvragen
        </button>
      </form>
      <hr />
      <button
        className="secondary"
        onClick={() =>
          void work(async () => setRows(await api("/reports/jobs")))
        }
      >
        Status vernieuwen
      </button>
      {rows.map((r) => (
        <div className="task-row" key={r.id}>
          <span className="task-text">
            <strong>
              {r.filters?.type} · {r.filters?.format?.toUpperCase()}
            </strong>
            <small>
              {new Date(r.createdAt).toLocaleString("nl-NL")} ·{" "}
              {(
                {
                  queued: "In wachtrij",
                  running: "Bezig",
                  completed: "Gereed",
                  failed: "Mislukt",
                } as Row
              )[r.status] || r.status}
              {r.error && " · " + r.error}
            </small>
          </span>
          {r.status === "completed" && (
            <button
              className="secondary"
              onClick={() =>
                void work(() =>
                  download(
                    "/reports/jobs/" + r.id + "/download",
                    "tuinwerk-export." + r.filters.format,
                  ),
                )
              }
            >
              Download
            </button>
          )}
        </div>
      ))}
    </>
  );
}

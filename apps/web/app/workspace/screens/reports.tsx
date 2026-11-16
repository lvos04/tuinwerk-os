"use client";
import { Field, type Row } from "../ui";
import { Download } from "lucide-react";
import type { WorkspaceView } from "../use-workspace";

export function ReportsScreen({ w }: { w: WorkspaceView }) {
  const { report, run, token, setNotice, busy } = w;
  return (
    <>
      <section className="panel padded">
        <h2>Werkoverzicht</h2>
        <p className="muted">
          Cijfers worden berekend uit de actuele registraties. Exporteer
          gegevens voor verdere analyse.
        </p>
        {report && (
          <div className="report-data">
            {Object.entries(report)
              .filter(([k, v]) => typeof v === "number" && k !== "sampleSize")
              .map(([k, v]) => (
                <div key={k}>
                  <small>
                    {(
                      {
                        total: "Totaal taken",
                        open: "Open",
                        completed: "Afgerond",
                        blocked: "Geblokkeerd",
                        overdue: "Achterstallig",
                        minutes: "Gewerkte minuten",
                        meanResolutionHours: "Gemiddelde doorlooptijd (uren)",
                      } as Row
                    )[k] || k}
                  </small>
                  <strong>
                    {typeof v === "number"
                      ? Math.round(v * 10) / 10
                      : String(v)}
                  </strong>
                </div>
              ))}
          </div>
        )}
        <p className="muted">{report?.definition}</p>
        <form
          className="form-grid"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(async () => {
              const q = new URLSearchParams();
              for (const [k, v] of f.entries()) if (v) q.set(k, String(v));
              const r = await fetch("/api/reports/export?" + q, {
                headers: { Authorization: "Bearer " + token },
              });
              if (!r.ok) throw new Error("Export kon niet worden gemaakt.");
              const blob = await r.blob();
              const url = URL.createObjectURL(blob);
              const a = document.createElement("a");
              a.href = url;
              a.download = "tuinwerk-export." + f.get("format");
              a.click();
              URL.revokeObjectURL(url);
              setNotice("Export gedownload.");
            });
          }}
        >
          <Field label="Gegevens">
            <select name="type">
              <option value="tasks">Taken</option>
              <option value="inventory">Voorraad</option>
            </select>
          </Field>
          <Field label="Bestandstype">
            <select name="format">
              <option value="csv">CSV</option>
              <option value="xlsx">Excel</option>
              <option value="pdf">PDF</option>
            </select>
          </Field>
          <Field label="Vanaf">
            <input type="date" name="from" />
          </Field>
          <Field label="Tot en met">
            <input type="date" name="to" />
          </Field>
          <button className="primary" disabled={busy}>
            <Download size={17} /> Export downloaden
          </button>
        </form>
      </section>
    </>
  );
}

"use client";
import { useState } from "react";
import { Field, type Row } from "./ui";

export function ImportForm({
  api,
  run,
  busy,
  onDone,
}: {
  api: (p: string, o?: RequestInit) => Promise<any>;
  run: (fn: () => Promise<void>) => Promise<void>;
  busy: boolean;
  onDone: () => Promise<void>;
}) {
  const [preview, setPreview] = useState<Row | null>(null),
    [kind, setKind] = useState("tasks");
  return (
    <>
      {!preview ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(async () => {
              const file = f.get("file") as File;
              const bytes = new Uint8Array(await file.arrayBuffer());
              let raw = "";
              for (const b of bytes) raw += String.fromCharCode(b);
              setPreview(
                await api(
                  kind === "tasks"
                    ? "/imports/preview"
                    : "/imports/catalog/preview",
                  {
                    method: "POST",
                    body: JSON.stringify({
                      kind,
                      filename: file.name,
                      content: btoa(raw),
                      mapping:
                        kind === "tasks"
                          ? {
                              title: f.get("titleColumn") || undefined,
                              description:
                                f.get("descriptionColumn") || undefined,
                              priority: f.get("priorityColumn") || undefined,
                              deadline: f.get("deadlineColumn") || undefined,
                            }
                          : undefined,
                    }),
                  },
                ),
              );
            });
          }}
        >
          <Field label="Importsoort">
            <select value={kind} onChange={(e) => setKind(e.target.value)}>
              <option value="tasks">Taken / Todoist</option>
              <option value="inventory">Artikelen</option>
              <option value="locations">Locaties</option>
            </select>
          </Field>
          {kind === "tasks" && (
            <div className="form-grid">
              <Field label="Kolom titel">
                <input name="titleColumn" placeholder="CONTENT" />
              </Field>
              <Field label="Kolom omschrijving">
                <input name="descriptionColumn" placeholder="DESCRIPTION" />
              </Field>
              <Field label="Kolom prioriteit">
                <input name="priorityColumn" placeholder="PRIORITY" />
              </Field>
              <Field label="Kolom deadline">
                <input name="deadlineColumn" placeholder="DATE" />
              </Field>
            </div>
          )}
          <Field label="CSV- of Excelbestand">
            <input type="file" name="file" accept=".csv,.xlsx" required />
          </Field>
          <button className="primary" disabled={busy}>
            Voorbeeld controleren
          </button>
        </form>
      ) : (
        <>
          <p>
            {preview.rows?.length || 0} regels · {preview.duplicates || 0}{" "}
            duplicaten
          </p>
          <pre className="preview">
            {JSON.stringify(preview.rows?.slice(0, 10), null, 2)}
          </pre>
          {preview.invalid > 0 && (
            <div className="alert error">
              {preview.invalid} ongeldige regels
            </div>
          )}
          <button
            className="primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                await api(
                  (kind === "tasks" ? "/imports/" : "/imports/catalog/") +
                    preview.id +
                    "/confirm",
                  { method: "POST", body: "{}" },
                );
                await onDone();
              })
            }
          >
            Import bevestigen
          </button>
        </>
      )}
    </>
  );
}

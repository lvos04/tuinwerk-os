"use client";
import { Field } from "../ui";
import { ChevronRight } from "lucide-react";
import type { WorkspaceView } from "../use-workspace";

export function CountsDialog({ w }: { w: WorkspaceView }) {
  const {
    submit,
    post,
    locations,
    busy,
    counts,
    run,
    setSelected,
    api,
    setDialog,
  } = w;
  return (
    <>
      <form
        onSubmit={(e) =>
          submit(e, async (f) => {
            await post("/inventory/counts", {
              name: f.get("name"),
              locationId: f.get("locationId") || undefined,
            });
          })
        }
      >
        <Field label="Naam telronde">
          <input name="name" required placeholder="Magazijntelling november" />
        </Field>
        <Field label="Locatie">
          <select name="locationId">
            <option value="">Alle locaties</option>
            {locations
              .filter((l) => l.active !== false)
              .map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
          </select>
        </Field>
        <button className="primary" disabled={busy}>
          Telronde starten
        </button>
      </form>
      <hr />
      {counts.map((c) => (
        <button
          className="task-row wide"
          key={c.id}
          onClick={() =>
            run(async () => {
              setSelected(await api("/inventory/counts/" + c.id));
              setDialog("countDetail");
            })
          }
        >
          <span className="task-text">{c.name}</span>
          <span className="badge">{c.status}</span>
          <ChevronRight size={16} />
        </button>
      ))}
    </>
  );
}

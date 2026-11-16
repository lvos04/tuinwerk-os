"use client";
import { Field } from "../ui";
import type { WorkspaceView } from "../use-workspace";

export function SeasonsDialog({ w }: { w: WorkspaceView }) {
  const { submit, post, setSeasons, api, busy, seasons, users } = w;
  return (
    <>
      <form
        onSubmit={(e) =>
          submit(e, async (f) => {
            const activities = String(f.get("activities"))
              .split("\n")
              .filter(Boolean)
              .map((line) => {
                const [offset, ...title] = line.split(";");
                return {
                  title: title.join(";").trim(),
                  offsetDays: Number(offset),
                };
              });
            await post("/seasons", {
              name: f.get("name"),
              activities,
            });
            setSeasons(await api("/seasons"));
          })
        }
      >
        <Field label="Naam seizoenssjabloon">
          <input name="name" required placeholder="Teeltwisseling" />
        </Field>
        <Field label="Activiteiten: relatieve dag; titel (één per regel)">
          <textarea
            name="activities"
            required
            rows={4}
            placeholder={"-7; Inspectie\n0; Schoonmaken\n2; Opstartcontrole"}
          />
        </Field>
        <button className="primary" disabled={busy}>
          Sjabloon opslaan
        </button>
      </form>
      <hr />
      {seasons.map((s) => (
        <form
          key={s.id}
          onSubmit={(e) =>
            submit(e, async (f) => {
              await post("/seasons/" + s.id + "/activate", {
                operationId: crypto.randomUUID(),
                date: f.get("date"),
                assigneeIds: f.getAll("assigneeIds"),
              });
            })
          }
        >
          <h3>{s.name}</h3>
          <p className="muted">{s.activities?.length} activiteiten</p>
          <Field label="Datum gebeurtenis">
            <input type="date" name="date" required />
          </Field>
          <Field label="Toewijzen">
            <select name="assigneeIds" multiple>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name}
                </option>
              ))}
            </select>
          </Field>
          <button className="secondary" disabled={busy}>
            Seizoen activeren
          </button>
          <hr />
        </form>
      ))}
    </>
  );
}

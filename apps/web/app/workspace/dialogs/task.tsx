"use client";
import { iso, Field, priorities } from "../ui";
import type { WorkspaceView } from "../use-workspace";

export function TaskDialog({ w }: { w: WorkspaceView }) {
  const { submit, post, taskContext, locations, assets, tasks, users, busy } =
    w;
  return (
    <form
      onSubmit={(e) =>
        submit(e, async (f) => {
          await post("/tasks", {
            title: f.get("title"),
            description: f.get("description"),
            priority: f.get("priority"),
            locationId: f.get("locationId") || null,
            assetId: f.get("assetId") || null,
            deadline: iso(String(f.get("deadline") || "")),
            assignedTo: f.getAll("assignedTo"),
            category: f.get("category"),
            tags: String(f.get("tags") || "")
              .split(",")
              .map((x) => x.trim())
              .filter(Boolean),
            estimatedMinutes: f.get("estimatedMinutes")
              ? Number(f.get("estimatedMinutes"))
              : null,
            plannedAt: iso(String(f.get("plannedAt") || "")),
            availableFrom: iso(String(f.get("availableFrom") || "")),
            dependencies: f.getAll("dependencies"),
          });
        })
      }
    >
      <Field label="Wat moet er gebeuren? *">
        <input
          name="title"
          required
          autoFocus
          placeholder="Bijvoorbeeld: lekkende koppeling bij pomp 2"
        />
      </Field>
      <Field label="Omschrijving">
        <textarea name="description" rows={3} />
      </Field>
      <div className="form-grid">
        <Field label="Prioriteit">
          <select name="priority" defaultValue="normal">
            {Object.entries(priorities).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Deadline">
          <input type="datetime-local" name="deadline" />
        </Field>
        <Field label="Locatie">
          <select
            name="locationId"
            defaultValue={taskContext?.locationId || ""}
          >
            <option value="">Geen locatie</option>
            {locations
              .filter((l) => l.active !== false)
              .map((l) => (
                <option value={l.id} key={l.id}>
                  {l.name}
                </option>
              ))}
          </select>
        </Field>
        <Field label="Machine">
          <select name="assetId" defaultValue={taskContext?.assetId || ""}>
            <option value="">Geen machine</option>
            {assets.map((l) => (
              <option value={l.id} key={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Categorie">
          <input name="category" placeholder="Reparatie, onderhoud…" />
        </Field>
        <Field label="Gepland op">
          <input name="plannedAt" type="datetime-local" />
        </Field>
        <Field label="Beschikbaar vanaf">
          <input name="availableFrom" type="datetime-local" />
        </Field>
        <Field label="Geschatte minuten">
          <input name="estimatedMinutes" type="number" min="0" />
        </Field>
        <Field label="Tags (komma gescheiden)">
          <input name="tags" />
        </Field>
        <Field label="Afhankelijk van">
          <select name="dependencies" multiple>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Medewerkers (meerdere mogelijk)">
          <select name="assignedTo" multiple>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </Field>
      </div>
      <button className="primary" disabled={busy}>
        Taak aanmaken
      </button>
    </form>
  );
}

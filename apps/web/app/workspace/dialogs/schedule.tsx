"use client";
import { iso, Field, localDateTime } from "../ui";
import type { WorkspaceView } from "../use-workspace";

export function ScheduleDialog({ w }: { w: WorkspaceView }) {
  const { submit, user, selected, api, post, tasks, users, busy } = w;
  return (
    <form
      onSubmit={(e) =>
        submit(e, async (f) => {
          const body = {
            title: f.get("title"),
            taskId: f.get("taskId") || null,
            userId: user.id,
            startsAt: iso(String(f.get("startsAt"))),
            endsAt: iso(String(f.get("endsAt"))),
            shared: f.get("shared") === "on",
            participants: f.getAll("participants"),
          };
          if (selected)
            await api("/schedules/" + selected.id, {
              method: "PATCH",
              body: JSON.stringify({
                ...body,
                version: selected.version,
                confirmShared:
                  !selected.shared ||
                  selected.userId === user.id ||
                  window.confirm(
                    "Deze wijziging raakt een gedeelde planning. De deelnemers worden geïnformeerd. Doorgaan?",
                  ),
              }),
            });
          else await post("/schedules", body);
        })
      }
    >
      <Field label="Titel">
        <input name="title" required defaultValue={selected?.title || ""} />
      </Field>
      <Field label="Taak">
        <select name="taskId" defaultValue={selected?.taskId || ""}>
          <option value="">Persoonlijk werkblok</option>
          {tasks.map((t) => (
            <option value={t.id} key={t.id}>
              {t.title}
            </option>
          ))}
        </select>
      </Field>
      <div className="form-grid">
        <Field label="Van">
          <input
            type="datetime-local"
            name="startsAt"
            defaultValue={localDateTime(selected?.startsAt)}
            required
          />
        </Field>
        <Field label="Tot">
          <input
            type="datetime-local"
            name="endsAt"
            defaultValue={localDateTime(selected?.endsAt)}
            required
          />
        </Field>
      </div>
      <Field label="Deelnemers">
        <select
          name="participants"
          multiple
          defaultValue={selected?.participants || []}
        >
          {users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </select>
      </Field>
      <label className="checkbox">
        <input
          name="shared"
          type="checkbox"
          defaultChecked={selected?.shared}
        />{" "}
        Delen met het team
      </label>
      <p className="muted">
        Dit werkblok wijzigt de deadline van de taak niet. Betrokken medewerkers
        ontvangen een melding bij gedeelde wijzigingen.
      </p>
      <button className="primary" disabled={busy}>
        Werkblok opslaan
      </button>
    </form>
  );
}

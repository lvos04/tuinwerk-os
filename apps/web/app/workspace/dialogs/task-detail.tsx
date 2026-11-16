"use client";
import { AlertTriangle, Plus, Clock } from "lucide-react";
import { statuses, priorities, iso, Field, date, type Row } from "../ui";
import { ReportContent } from "../../moderation";
import { TaskWorkbench } from "../../productivity";
import { MediaGallery } from "../../tools2";
import type { WorkspaceView } from "../use-workspace";

export function TaskDetailDialog({ w }: { w: WorkspaceView }) {
  const {
    selected,
    tasks,
    api,
    detailTab,
    setDetailTab,
    token,
    user,
    items,
    locations,
    setSelected,
    reload,
    run,
    updateTask,
    setNotice,
    users,
    busy,
    checklist,
    comments,
    name,
    post,
    setComments,
    times,
    setTimes,
    submit,
    setAnnotationTarget,
    setDialog,
  } = w;
  if (!selected) return null;
  return (
    <>
      {selected.dependencies?.some(
        (id: string) => tasks.find((t) => t.id === id)?.status !== "completed",
      ) && (
        <div className="alert error">
          <AlertTriangle size={18} />
          <span>
            Voorgaand werk is nog niet afgerond:{" "}
            {selected.dependencies
              .filter(
                (id: string) =>
                  tasks.find((t) => t.id === id)?.status !== "completed",
              )
              .map((id: string) => tasks.find((t) => t.id === id)?.title || id)
              .join(", ")}
          </span>
        </div>
      )}
      <div className="toolbar">
        <span className={"badge " + selected.status}>
          {statuses[selected.status]}
        </span>
        <span className={"badge " + selected.priority}>
          {priorities[selected.priority]}
        </span>
        <span className="muted">Versie {selected.version}</span>
        <ReportContent api={api} type="task" id={selected.id} />
      </div>
      <div className="tabs detail-tabs">
        {[
          ["work", "Uitvoeren"],
          ["details", "Details"],
          ["checklist", "Checklist"],
          ["comments", "Reacties"],
          ["time", "Tijd"],
          ["media", "Bijlagen"],
        ].map(([v, l]) => (
          <button
            className={detailTab === v ? "active" : ""}
            key={v}
            onClick={() => setDetailTab(v)}
          >
            {l}
          </button>
        ))}
      </div>
      {detailTab === "work" && (
        <TaskWorkbench
          api={api}
          token={token}
          task={selected}
          user={user}
          items={items}
          locations={locations}
          onUpdated={async (task) => {
            setSelected(task);
            await reload();
          }}
          onReload={reload}
        />
      )}
      {detailTab === "details" && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            run(async () => {
              await updateTask({
                title: f.get("title"),
                description: f.get("description"),
                status: f.get("status"),
                reason: f.get("reason"),
                priority: f.get("priority"),
                assignedTo: f.getAll("assignedTo"),
                deadline: iso(String(f.get("deadline") || "")),
              });
              setNotice("Taak bijgewerkt.");
            });
          }}
        >
          <Field label="Titel">
            <input
              name="title"
              required
              defaultValue={selected.title}
              key={selected.id}
            />
          </Field>
          <Field label="Omschrijving">
            <textarea
              name="description"
              defaultValue={selected.description}
              rows={3}
            />
          </Field>
          <div className="form-grid">
            <Field label="Status">
              <select
                name="status"
                defaultValue={selected.status}
                key={selected.status}
              >
                {Object.entries(statuses).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Prioriteit">
              <select name="priority" defaultValue={selected.priority}>
                {Object.entries(priorities).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Deadline">
              <input
                name="deadline"
                type="datetime-local"
                defaultValue={
                  selected.deadline
                    ? new Date(
                        new Date(selected.deadline).getTime() -
                          new Date(selected.deadline).getTimezoneOffset() *
                            60000,
                      )
                        .toISOString()
                        .slice(0, 16)
                    : ""
                }
              />
            </Field>
            <Field label="Toegewezen aan">
              <select
                name="assignedTo"
                multiple
                defaultValue={selected.assignedTo || []}
              >
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name}
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Field label="Reden (verplicht bij blokkeren en heropenen)">
            <input name="reason" />
          </Field>
          <button className="primary" disabled={busy}>
            Wijzigingen opslaan
          </button>
        </form>
      )}
      {detailTab === "checklist" && (
        <>
          <div className="checklist">
            {checklist.map((c: Row, i: number) => (
              <label key={c.id || i}>
                <input
                  type="checkbox"
                  checked={!!c.done}
                  onChange={(e) =>
                    run(() =>
                      updateTask({
                        checklist: checklist.map((x: Row, j: number) =>
                          i === j ? { ...x, done: e.target.checked } : x,
                        ),
                      }),
                    )
                  }
                />
                <span>
                  {c.text}
                  {c.required && <small> Verplicht</small>}
                </span>
              </label>
            ))}
          </div>
          <form
            className="inline-form"
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget,
                f = new FormData(form);
              run(async () => {
                await updateTask({
                  checklist: [
                    ...checklist,
                    {
                      id: crypto.randomUUID(),
                      text: f.get("text"),
                      required: f.get("required") === "on",
                      done: false,
                    },
                  ],
                });
                form.reset();
              });
            }}
          >
            <input
              name="text"
              aria-label="Checklistpunt"
              required
              placeholder="Nieuw checklistpunt"
            />
            <label>
              <input type="checkbox" name="required" /> Verplicht
            </label>
            <button className="secondary" disabled={busy}>
              <Plus size={16} />
              Toevoegen
            </button>
          </form>
        </>
      )}
      {detailTab === "comments" && (
        <>
          {comments.map((c) => (
            <div className="comment" key={c.id}>
              <strong>
                {name(users, c.userId || c.authorId)}{" "}
                <small>{date(c.createdAt)}</small>
              </strong>
              <p>{c.body}</p>
              <ReportContent api={api} type="comment" id={c.id} />
            </div>
          ))}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget,
                f = new FormData(form);
              run(async () => {
                await post("/tasks/" + selected.id + "/comments", {
                  body: f.get("body"),
                });
                setComments(await api("/tasks/" + selected.id + "/comments"));
                form.reset();
              });
            }}
          >
            <Field label="Nieuwe reactie">
              <textarea name="body" required rows={3} />
            </Field>
            <button className="primary" disabled={busy}>
              Reactie plaatsen
            </button>
          </form>
        </>
      )}
      {detailTab === "time" && (
        <>
          <div>
            {times.map((t) => (
              <div className="task-row" key={t.id}>
                <Clock size={16} />
                <span className="task-text">
                  {name(users, t.userId)}
                  <small>
                    {date(t.startedAt)} · {t.note}
                  </small>
                </span>
                <strong>{t.minutes ?? "Loopt"} min</strong>
                {!t.endedAt && t.userId === user.id && (
                  <button
                    className="secondary"
                    onClick={() =>
                      run(async () => {
                        await post("/time/" + t.id + "/stop", {});
                        setTimes(await api("/tasks/" + selected.id + "/time"));
                      })
                    }
                  >
                    Stop timer
                  </button>
                )}
              </div>
            ))}
          </div>
          <button
            className="secondary"
            onClick={() =>
              run(async () => {
                await post("/tasks/" + selected.id + "/time", {
                  startedAt: new Date().toISOString(),
                });
                setTimes(await api("/tasks/" + selected.id + "/time"));
              })
            }
          >
            <Clock size={16} /> Timer starten
          </button>
          <hr />
          <form
            onSubmit={(e) =>
              submit(e, async (f) => {
                await post("/tasks/" + selected.id + "/time", {
                  minutes: Number(f.get("minutes")),
                  note: f.get("note"),
                  startedAt: iso(String(f.get("startedAt"))),
                });
              })
            }
          >
            <Field label="Starttijd">
              <input type="datetime-local" name="startedAt" required />
            </Field>
            <Field label="Gewerkte minuten">
              <input type="number" min="1" name="minutes" required />
            </Field>
            <Field label="Toelichting">
              <input name="note" />
            </Field>
            <button className="primary" disabled={busy}>
              Tijd registreren
            </button>
          </form>
        </>
      )}
      {detailTab === "media" && (
        <MediaGallery
          api={api}
          token={token}
          taskId={selected.id}
          onAnnotate={(a) => {
            setAnnotationTarget(a);
            setDialog("annotation");
          }}
        />
      )}
    </>
  );
}

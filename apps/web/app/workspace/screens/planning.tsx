"use client";
import { RefreshCw, CalendarDays } from "lucide-react";
import { CapacityPlanning } from "../../productivity";
import { Calendar } from "../../tools";
import { date, Empty } from "../ui";
import { YearPlanning } from "../../year-planning";
import type { WorkspaceView } from "../use-workspace";

export function PlanningScreen({ w }: { w: WorkspaceView }) {
  const {
    view,
    setView,
    setDialog,
    setSelected,
    api,
    user,
    users,
    openTask,
    schedules,
    run,
    reload,
    rules,
    tasks,
    assets,
    locations,
    name,
  } = w;
  return (
    <>
      <div className="toolbar">
        <div className="tabs">
          {[
            ["list", "Mijn planning"],
            ["team", "Teamplanning"],
            ["year", "Jaarplanning"],
            ["calendar", "Kalender"],
            ["capacity", "Capaciteit"],
            ["maintenance", "Onderhoud"],
          ].map(([id, label]) => (
            <button
              key={id}
              className={view === id ? "active" : ""}
              onClick={() => setView(id)}
            >
              {label}
            </button>
          ))}
        </div>
        <button className="secondary" onClick={() => setDialog("seasons")}>
          Seizoensplanning
        </button>
        <button
          className="secondary"
          onClick={() => {
            setSelected(null);
            setDialog("recurrence");
          }}
        >
          <RefreshCw size={16} /> Herhaling toevoegen
        </button>
      </div>
      {view === "capacity" ? (
        <CapacityPlanning
          api={api}
          user={user}
          users={users}
          onOpenTask={openTask}
        />
      ) : view === "calendar" ? (
        <Calendar
          schedules={schedules}
          onEdit={(s) => {
            setSelected(s);
            setDialog("schedule");
          }}
          onMove={async (s, start, end) => {
            if (
              s.shared &&
              !window.confirm(
                "Dit verplaatst een gedeeld werkblok. Betrokkenen ontvangen een melding. Doorgaan?",
              )
            )
              return;
            await run(async () => {
              await api("/schedules/" + s.id, {
                method: "PATCH",
                body: JSON.stringify({
                  version: s.version,
                  startsAt: start,
                  endsAt: end,
                  confirmShared: true,
                }),
              });
              await reload();
            });
          }}
        />
      ) : view === "maintenance" ? (
        <div className="panel">
          {rules.length ? (
            rules.map((r) => (
              <div className="task-row" key={r.id}>
                <RefreshCw size={18} />
                <div className="task-text">
                  <strong>{r.title}</strong>
                  <small>
                    {r.config?.frequency} · vanaf {date(r.config?.startDate)}
                  </small>
                </div>
                <button
                  className="text-button"
                  onClick={() => {
                    setSelected(r);
                    setDialog("recurrence");
                  }}
                >
                  Bewerken
                </button>
              </div>
            ))
          ) : (
            <Empty title="Nog geen onderhoudsregels" />
          )}
        </div>
      ) : view === "year" ? (
        <YearPlanning
          api={api}
          tasks={tasks}
          assets={assets}
          locations={locations}
          openTask={openTask}
        />
      ) : (
        <div className="panel">
          {schedules.filter(
            (s) =>
              view === "team" || s.userId === user.id || s.ownerId === user.id,
          ).length ? (
            schedules
              .filter(
                (s) =>
                  view === "team" ||
                  s.userId === user.id ||
                  s.ownerId === user.id,
              )
              .sort((a, b) =>
                (a.startsAt || a.startAt || a.start).localeCompare(
                  b.startsAt || b.startAt || b.start,
                ),
              )
              .map((s) => (
                <div className="task-row" key={s.id}>
                  <CalendarDays size={20} />
                  <div className="task-text">
                    <strong>
                      {s.title ||
                        tasks.find((t) => t.id === s.taskId)?.title ||
                        "Werkblok"}
                    </strong>
                    <small>
                      {date(s.startsAt || s.startAt || s.start)} ·{" "}
                      {new Date(
                        s.startsAt || s.startAt || s.start,
                      ).toLocaleTimeString("nl-NL", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      –{" "}
                      {new Date(
                        s.endsAt || s.endAt || s.end,
                      ).toLocaleTimeString("nl-NL", {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}{" "}
                      · {name(users, s.userId || s.ownerId)}
                    </small>
                  </div>
                  <span className="badge">
                    {s.shared ? "Gedeeld" : "Persoonlijk"}
                  </span>
                  <button
                    className="text-button"
                    onClick={() => {
                      setSelected(s);
                      setDialog("schedule");
                    }}
                  >
                    Bewerken
                  </button>
                </div>
              ))
          ) : (
            <Empty title="Nog geen werkblokken">
              Plan een taak of maak een persoonlijk werkblok.
            </Empty>
          )}
        </div>
      )}
    </>
  );
}

"use client";
import { FavoriteShortcuts } from "../../productivity";
import {
  ClipboardList,
  AlertTriangle,
  Clock,
  Boxes,
  ArrowUpRight,
  ChevronRight,
  Wrench,
  MapPin,
  CalendarDays,
  Sprout,
  Plus,
} from "lucide-react";
import { priorities, date, statuses, Empty } from "../ui";
import type { WorkspaceView } from "../use-workspace";

export function DashboardScreen({ w }: { w: WorkspaceView }) {
  const {
    api,
    assets,
    locations,
    setSelected,
    setTaskContext,
    setDialog,
    reload,
    openTask,
    active,
    urgent,
    overdue,
    low,
    profilePrefs,
    setPage,
    setFilter,
    name,
    schedules,
    today,
    tasks,
  } = w;
  return (
    <>
      <FavoriteShortcuts
        api={api}
        assets={assets}
        locations={locations}
        onUse={(favorite) => {
          const asset = assets.find((a) => a.id === favorite.id);
          setSelected(null);
          setTaskContext(
            favorite.type === "asset"
              ? {
                  assetId: favorite.id,
                  locationId: asset?.locationId || "",
                }
              : { locationId: favorite.id },
          );
          setDialog("task");
        }}
        onCreated={async (task) => {
          await reload();
          await openTask(task);
        }}
      />
      <div className="stats">
        {[
          [
            active.length,
            "Openstaande taken",
            "Alles wat nog aandacht vraagt",
            ClipboardList,
          ],
          [
            urgent.length,
            "Hoge prioriteit",
            "Eerst even naar kijken",
            AlertTriangle,
          ],
          [overdue.length, "Achterstallig", "Voorbij de deadline", Clock],
          [low.length, "Lage voorraad", "Tijd om aan te vullen", Boxes],
        ].map(
          ([v, label, sub, Icon]: any, i) =>
            (!profilePrefs.preferences?.dashboardMetrics ||
              profilePrefs.preferences.dashboardMetrics.includes(
                String(i),
              )) && (
              <button
                className={"stat stat-" + i}
                key={label}
                onClick={() => {
                  setPage(i === 3 ? "inventory" : "tasks");
                  setFilter(i === 2 ? "overdue" : "active");
                }}
              >
                <div>
                  <span>{label}</span>
                  <Icon size={19} />
                </div>
                <strong>{v}</strong>
                <small>
                  {sub}
                  <ArrowUpRight size={15} />
                </small>
              </button>
            ),
        )}
      </div>
      <div className="dashboard-grid">
        <section className="panel">
          <div className="panel-head">
            <h2>
              Werk dat aandacht vraagt{" "}
              <span className="count">{active.length}</span>
            </h2>
            <button
              className="text-button"
              onClick={() => {
                setPage("tasks");
                setFilter("active");
              }}
            >
              Alle taken <ChevronRight size={15} />
            </button>
          </div>
          {active.length ? (
            <div className="task-list">
              {[...active]
                .sort(
                  (a, b) =>
                    Object.keys(priorities).indexOf(b.priority) -
                    Object.keys(priorities).indexOf(a.priority),
                )
                .slice(0, 6)
                .map((t) => (
                  <button
                    className="task-row"
                    key={t.id}
                    onClick={() => openTask(t)}
                  >
                    <span className={"task-symbol " + t.priority}>
                      {t.priority === "critical" ? (
                        <AlertTriangle size={18} />
                      ) : (
                        <Wrench size={17} />
                      )}
                    </span>
                    <span className="task-text">
                      <strong>{t.title}</strong>
                      <small>
                        <MapPin size={12} />
                        {name(locations, t.locationId)} · {date(t.deadline)}
                      </small>
                    </span>
                    <span className={"badge " + t.status}>
                      {statuses[t.status]}
                    </span>
                    <ChevronRight size={16} />
                  </button>
                ))}
            </div>
          ) : (
            <Empty title="Een frisse start">
              Maak een taak aan voor je eerste melding of onderhoudsklus.
            </Empty>
          )}
        </section>
        <section className="panel today-panel">
          <div className="panel-head">
            <h2>Op de planning</h2>
            <CalendarDays size={18} />
          </div>
          {schedules.filter(
            (s) =>
              (s.startsAt || s.startAt || s.start || "").slice(0, 10) === today,
          ).length ? (
            schedules
              .filter(
                (s) =>
                  (s.startsAt || s.startAt || s.start || "").slice(0, 10) ===
                  today,
              )
              .map((s) => (
                <div className="schedule-mini" key={s.id}>
                  <span>
                    {new Date(
                      s.startsAt || s.startAt || s.start,
                    ).toLocaleTimeString("nl-NL", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                  <strong>
                    {s.title || tasks.find((t) => t.id === s.taskId)?.title}
                  </strong>
                </div>
              ))
          ) : (
            <Empty title="Ruimte in de agenda">
              Er staan vandaag geen zichtbare werkblokken gepland.
            </Empty>
          )}
          <button
            className="secondary wide"
            onClick={() => setPage("planning")}
          >
            Bekijk de planning <ArrowUpRight size={16} />
          </button>
        </section>
        <section className="quick-banner">
          <div className="banner-icon">
            <Sprout size={28} />
          </div>
          <div>
            <h3>Iets gezien dat aandacht nodig heeft?</h3>
            <p>Leg een storing direct vast. Je team kan meteen verder.</p>
          </div>
          <button className="secondary" onClick={() => setDialog("task")}>
            <Plus size={17} /> Snelle melding
          </button>
        </section>
      </div>
    </>
  );
}

"use client";

import {
  Sprout,
  Bell,
  Search,
  Plus,
  ChevronRight,
  LogOut,
  Menu,
  X,
  Check,
  AlertTriangle,
  RefreshCw,
  Leaf,
} from "lucide-react";

import { SetupGate } from "./system-settings";

import { useWorkspace, type WorkspaceView } from "./workspace/use-workspace";
import { DashboardScreen } from "./workspace/screens/dashboard";
import { TasksScreen } from "./workspace/screens/tasks";
import { PlanningScreen } from "./workspace/screens/planning";
import { PlacesScreen } from "./workspace/screens/places";
import { InventoryScreen } from "./workspace/screens/inventory";
import { ReportsScreen } from "./workspace/screens/reports";
import { SettingsScreen } from "./workspace/screens/settings";
import { TaskDialog } from "./workspace/dialogs/task";
import { TaskDetailDialog } from "./workspace/dialogs/task-detail";
import { AssetDialog } from "./workspace/dialogs/asset";
import { AssetDetailDialog } from "./workspace/dialogs/asset-detail";
import { ItemDialog } from "./workspace/dialogs/item";
import { MovementDialog } from "./workspace/dialogs/movement";
import { ItemDetailDialog } from "./workspace/dialogs/item-detail";
import { ScheduleDialog } from "./workspace/dialogs/schedule";
import { RecurrenceDialog } from "./workspace/dialogs/recurrence";
import { UserDialog } from "./workspace/dialogs/user";
import { NotificationsDialog } from "./workspace/dialogs/notifications";
import { CountsDialog } from "./workspace/dialogs/counts";
import { CountDetailDialog } from "./workspace/dialogs/count-detail";
import { SeasonsDialog } from "./workspace/dialogs/seasons";
import { NotificationPrefsDialog } from "./workspace/dialogs/notification-prefs";
import { AdvancedDialog } from "./workspace/dialogs/advanced";
import { AnnotationDialog } from "./workspace/dialogs/annotation";
import { ProfilePrefsDialog } from "./workspace/dialogs/profile-prefs";
import { SearchDialog } from "./workspace/dialogs/search";
import { ImportDialog } from "./workspace/dialogs/import";
import { LoginScreen } from "./workspace/screens/login";
import { type Row, nav } from "./workspace/ui";
function Workspace() {
  const w = useWorkspace();
  const {
    setToken,
    user,
    setUser,
    page,
    setPage,
    ready,
    error,
    setError,
    notice,
    setSearch,
    mobile,
    setMobile,
    notifications,
    dialog,
    setDialog,
    selected,
    setSelected,
    annotationTarget,
    setSearchResults,
    modalRef,
    prefs,
    post,
    run,
    reload,
    active,
  } = w;
  if (!ready)
    return (
      <div className="loading">
        <Sprout /> TuinWerk laden…
      </div>
    );
  if (!user) return <LoginScreen w={w} />;
  const sw: WorkspaceView = { ...w, user };
  return (
    <div className="shell">
      <aside className={"sidebar " + (mobile ? "visible" : "")}>
        <a
          className="brand"
          href="#"
          onClick={(e) => {
            e.preventDefault();
            setPage("dashboard");
          }}
        >
          <Sprout size={31} />
          <span>
            TuinWerk <b>OS</b>
          </span>
        </a>
        <div className="workspace">
          <span className="workspace-icon">
            <Leaf size={17} />
          </span>
          <div>
            Onze werkomgeving<small>Samen aan het werk</small>
          </div>
          <ChevronRight size={15} />
        </div>
        <p className="nav-label">WERKPLEK</p>
        <nav>
          {nav
            .filter(([id]) => id !== "settings" || user.role === "admin")
            .map(([id, label, Icon]) => (
              <button
                key={id}
                className={page === id ? "active" : ""}
                onClick={() => {
                  setPage(id);
                  setSearch("");
                  setMobile(false);
                }}
              >
                <Icon size={19} />
                {label}
                {id === "tasks" && active.length > 0 && (
                  <span className="nav-count">{active.length}</span>
                )}
              </button>
            ))}
        </nav>
        <div className="sidebar-bottom">
          <div className="connection">
            <i /> Verbonden met je server
          </div>
          <button
            className="profile"
            onClick={() =>
              run(async () => {
                await post("/auth/logout", {});
                sessionStorage.removeItem("tuinwerk-token");
                sessionStorage.removeItem("tuinwerk-refresh");
                setToken("");
                setUser(null);
              })
            }
          >
            <span className="avatar">{user.name?.slice(0, 1) || "M"}</span>
            <span>
              {user.name}
              <small>
                {user.role === "admin" ? "Beheerder" : "Medewerker"}
              </small>
            </span>
            <LogOut size={17} />
          </button>
        </div>
      </aside>
      <div className="main">
        <header className="topbar">
          <button
            className="icon-button menu"
            aria-label="Menu"
            onClick={() => setMobile(!mobile)}
          >
            <Menu />
          </button>
          <span className="breadcrumb">
            Werkplek <ChevronRight size={13} />{" "}
            <strong>{nav.find((n) => n[0] === page)?.[1]}</strong>
          </span>
          <div className="top-actions">
            <button
              className="icon-button"
              aria-label="Overal zoeken"
              onClick={() => {
                setSearchResults([]);
                setDialog("search");
              }}
            >
              <Search size={19} />
            </button>
            <button
              className="icon-button"
              aria-label="Gegevens vernieuwen"
              onClick={() => run(() => reload())}
            >
              <RefreshCw size={18} />
            </button>
            <button
              className="icon-button bell"
              aria-label="Meldingen"
              onClick={() => setDialog("notifications")}
            >
              <Bell size={19} />
              {notifications.some((n) => !n.readAt) && <i />}
            </button>
            <button
              className="avatar small"
              aria-label="Persoonlijke voorkeuren"
              onClick={() => setDialog("profilePrefs")}
            >
              {user.name?.slice(0, 1)}
            </button>
          </div>
        </header>
        <main className="content">
          {error && (
            <div className="alert error" role="alert">
              <AlertTriangle size={18} />
              <span>{error}</span>
              <button aria-label="Sluiten" onClick={() => setError("")}>
                <X size={16} />
              </button>
            </div>
          )}
          {notice && (
            <div className="alert success" role="status">
              <Check size={18} />
              {notice}
            </div>
          )}
          <div className="page-heading">
            <div>
              <span className="eyebrow">
                {new Date().toLocaleDateString("nl-NL", {
                  weekday: "long",
                  day: "numeric",
                  month: "long",
                  year: "numeric",
                })}
              </span>
              <h1>
                {page === "dashboard"
                  ? `Goedendag, ${user.name?.split(" ")[0] || "collega"}`
                  : nav.find((n) => n[0] === page)?.[1]}
                {page === "dashboard" && <span className="greeting">☀</span>}
              </h1>
              <p>
                {
                  {
                    dashboard:
                      "Dit speelt er vandaag. Samen houden we alles draaiende.",
                    tasks:
                      "Van melding naar oplossing. Alle werkzaamheden bij elkaar.",
                    planning: "Maak ruimte voor het werk dat eraan komt.",
                    assets: "Je installaties en hun onderhoudshistorie.",
                    locations:
                      "Een duidelijke plek voor elke machine en ieder onderdeel.",
                    inventory: "Weet wat je hebt en waar je het vindt.",
                    reports: "Inzicht in werkzaamheden, tijd en verbruik.",
                    settings: "Beheer je team en je werkomgeving.",
                  }[page]
                }
              </p>
            </div>
            <button
              className="primary"
              onClick={() => {
                setSelected(null);
                setDialog(
                  page === "assets"
                    ? "asset"
                    : page === "locations"
                      ? "location"
                      : page === "inventory"
                        ? "item"
                        : page === "planning"
                          ? "schedule"
                          : page === "settings"
                            ? "user"
                            : "task",
                );
              }}
            >
              <Plus size={18} />
              {(
                {
                  assets: "Machine toevoegen",
                  locations: "Locatie toevoegen",
                  inventory: "Artikel toevoegen",
                  planning: "Werkblok plannen",
                  settings: "Medewerker toevoegen",
                } as Row
              )[page] || "Nieuwe taak"}
            </button>
          </div>
          <div className="toolbar">
            <button className="secondary" onClick={() => setDialog("advanced")}>
              {(
                {
                  tasks: "Sjablonen, bulk wijzigen en AI",
                  inventory: "Artikelen, minima en mutatiehistorie",
                  planning: "Seizoenen aanpassen",
                  reports: "Achtergrondexports en AI",
                  settings: "Accountbeveiliging en gegevensbeheer",
                } as Row
              )[page] || "Sjablonen en slimme taakvoorstellen"}
            </button>
          </div>
          {page === "dashboard" && <DashboardScreen w={sw} />}
          {page === "tasks" && <TasksScreen w={sw} />}
          {page === "planning" && <PlanningScreen w={sw} />}
          {(page === "assets" || page === "locations") && (
            <PlacesScreen w={sw} />
          )}
          {page === "inventory" && <InventoryScreen w={sw} />}
          {page === "reports" && <ReportsScreen w={sw} />}
          {page === "settings" && <SettingsScreen w={sw} />}
          <footer className="page-footer">
            <Sprout size={14} /> TuinWerk OS{" "}
            <span>Alles op zijn plek. Samen vooruit.</span>
          </footer>
        </main>
      </div>
      {dialog && (
        <div className="modal-backdrop" onClick={() => setDialog("")}>
          <section
            ref={modalRef}
            className={"modal " + (dialog === "taskDetail" ? "large" : "")}
            role="dialog"
            aria-modal="true"
            aria-label="Gegevens bewerken"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h2>
                {
                  (
                    {
                      task: "Nieuwe taak",
                      taskDetail: selected?.title,
                      asset: "Machine toevoegen",
                      assetDetail: selected?.name,
                      location: selected
                        ? "Locatie bewerken"
                        : "Locatie toevoegen",
                      item: "Artikel toevoegen",
                      itemDetail: selected?.name,
                      movement: "Voorraad boeken",
                      schedule: "Werkblok plannen",
                      recurrence: "Terugkerend onderhoud",
                      user: "Medewerker toevoegen",
                      notifications: "Meldingen",
                      counts: "Inventarisatie",
                      countDetail: selected?.name || "Telronde",
                      seasons: "Seizoensplanning",
                      notificationPrefs: "Meldingsvoorkeuren",
                      search: "Overal zoeken",
                      profilePrefs: "Persoonlijke voorkeuren",
                      annotation: "Foto bekijken en annoteren",
                      ai: "Taakvoorstel met AI",
                      advanced: "Aanvullende functies",
                      import: "Gegevens importeren",
                    } as Row
                  )[dialog]
                }
              </h2>
              <button
                className="icon-button"
                aria-label="Dialoog sluiten"
                onClick={() => setDialog("")}
              >
                <X size={20} />
              </button>
            </div>
            {error && (
              <div className="alert error" role="alert">
                {error}
              </div>
            )}
            {dialog === "task" && <TaskDialog w={sw} />}
            {dialog === "taskDetail" && selected && <TaskDetailDialog w={sw} />}
            {(dialog === "asset" || dialog === "location") && (
              <AssetDialog w={sw} />
            )}
            {dialog === "assetDetail" && selected && (
              <AssetDetailDialog w={sw} />
            )}
            {dialog === "item" && <ItemDialog w={sw} />}
            {dialog === "movement" && <MovementDialog w={sw} />}
            {dialog === "itemDetail" && <ItemDetailDialog w={sw} />}
            {dialog === "schedule" && <ScheduleDialog w={sw} />}
            {dialog === "recurrence" && <RecurrenceDialog w={sw} />}
            {dialog === "user" && <UserDialog w={sw} />}
            {dialog === "notifications" && <NotificationsDialog w={sw} />}
            {dialog === "counts" && <CountsDialog w={sw} />}
            {dialog === "countDetail" && selected && (
              <CountDetailDialog w={sw} />
            )}
            {dialog === "seasons" && <SeasonsDialog w={sw} />}
            {dialog === "notificationPrefs" && prefs && (
              <NotificationPrefsDialog w={sw} />
            )}
            {dialog === "advanced" && <AdvancedDialog w={sw} />}
            {dialog === "annotation" && annotationTarget && (
              <AnnotationDialog w={sw} />
            )}
            {dialog === "profilePrefs" && <ProfilePrefsDialog w={sw} />}
            {dialog === "search" && <SearchDialog w={sw} />}
            {dialog === "import" && <ImportDialog w={sw} />}
          </section>
        </div>
      )}
    </div>
  );
}

export default function App() {
  return (
    <SetupGate>
      <Workspace />
    </SetupGate>
  );
}

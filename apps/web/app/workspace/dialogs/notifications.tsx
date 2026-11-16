"use client";
import { Bell } from "lucide-react";
import { date, Empty } from "../ui";
import type { WorkspaceView } from "../use-workspace";

export function NotificationsDialog({ w }: { w: WorkspaceView }) {
  const { run, setPrefs, api, setDialog, notifications, reload } = w;
  return (
    <>
      <button
        className="secondary"
        onClick={() =>
          run(async () => {
            setPrefs(await api("/notifications/preferences"));
            setDialog("notificationPrefs");
          })
        }
      >
        Voorkeuren en stille uren
      </button>
      {notifications.length ? (
        notifications.map((n) => (
          <button
            className={"notification " + (!n.readAt ? "unread" : "")}
            key={n.id}
            onClick={() =>
              run(async () => {
                await api("/notifications/" + n.id + "/read", {
                  method: "PATCH",
                });
                await reload();
              })
            }
          >
            <Bell size={18} />
            <span>
              <strong>{n.title || n.type}</strong>
              <p>{n.body || n.message}</p>
              <small>
                {date(n.createdAt)}
                {!n.readAt ? " · Markeren als gelezen" : ""}
              </small>
            </span>
          </button>
        ))
      ) : (
        <Empty title="Helemaal bij">Nieuwe meldingen verschijnen hier.</Empty>
      )}
    </>
  );
}

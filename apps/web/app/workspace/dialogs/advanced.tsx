"use client";
import { AdvancedTools } from "../../tools2";
import type { WorkspaceView } from "../use-workspace";

export function AdvancedDialog({ w }: { w: WorkspaceView }) {
  const {
    page,
    api,
    token,
    user,
    tasks,
    items,
    assets,
    locations,
    users,
    reload,
  } = w;
  return (
    <AdvancedTools
      page={page}
      api={api}
      token={token}
      user={user}
      tasks={tasks}
      items={items}
      assets={assets}
      locations={locations}
      users={users}
      reload={reload}
    />
  );
}

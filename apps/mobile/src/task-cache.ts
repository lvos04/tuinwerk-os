import { PendingOperation } from "./queue";
type Row = Record<string, any>;
export function projectTasks(
  server: Row[],
  operations: PendingOperation[],
): Row[] {
  let rows = server.map((row) => ({ ...row }));
  for (const operation of operations) {
    if (operation.path === "/tasks" && operation.method === "POST") {
      const task: Row = {
        ...operation.payload,
        version: 1,
        status: "open",
        localDraft: true,
      };
      if (!rows.some((row) => row.id === task.id)) rows = [task, ...rows];
    } else if (
      /^\/tasks\/[^/]+$/.test(operation.path) &&
      operation.method === "PATCH"
    ) {
      const id = operation.path.split("/").pop();
      rows = rows.map((row) =>
        row.id === id
          ? {
              ...row,
              ...operation.payload,
              version: Number(operation.payload.version) + 1,
              localDraft: true,
            }
          : row,
      );
    }
  }
  return rows;
}

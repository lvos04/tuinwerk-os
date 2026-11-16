"use client";
import { ImportForm } from "../import-form";
import type { WorkspaceView } from "../use-workspace";

export function ImportDialog({ w }: { w: WorkspaceView }) {
  const { api, run, busy, setDialog, setNotice, reload } = w;
  return (
    <ImportForm
      api={api}
      run={run}
      busy={busy}
      onDone={async () => {
        setDialog("");
        setNotice("Import verwerkt.");
        await reload();
      }}
    />
  );
}

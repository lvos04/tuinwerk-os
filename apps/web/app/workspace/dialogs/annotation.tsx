"use client";
import { AnnotationEditor } from "../../tools";
import type { WorkspaceView } from "../use-workspace";

export function AnnotationDialog({ w }: { w: WorkspaceView }) {
  const { annotationTarget, token, post, setDialog, setDetailTab } = w;
  if (!annotationTarget) return null;
  return (
    <AnnotationEditor
      attachment={annotationTarget}
      token={token}
      onSave={async (annotation) => {
        await post("/attachments/" + annotationTarget.id + "/annotation", {
          annotation,
          version: annotationTarget.version,
        });
        setDialog(annotationTarget.taskId ? "taskDetail" : "assetDetail");
        setDetailTab("media");
      }}
    />
  );
}

import { FilesApp } from "@/components/files/FilesApp";

/** Files and desktop shortcuts share the same real Trash. */
export function RecycleBinApp({ windowId }: { windowId: string }) {
  return <FilesApp windowId={windowId} initialPath="Trash" />;
}

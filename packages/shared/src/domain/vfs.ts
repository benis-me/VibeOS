export type VfsNodeType = "file" | "folder" | "shortcut";
export type VfsLocation = "desktop" | "folder" | "recyclebin";

export interface VfsNode {
  id: string;
  parentId?: string;
  name: string;
  type: VfsNodeType;
  mime?: string;
  /** Text content for files. */
  content?: string;
  /** For shortcuts: the app this points to. */
  targetAppId?: string;
  location: VfsLocation;
  /** Desktop grid position. */
  x?: number;
  y?: number;
  deletedAt?: number;
  meta: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

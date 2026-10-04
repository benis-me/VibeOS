export interface AppMemory {
  windowId: string;
  appId: string;
  /** The current rendered HTML body of the window (AI-generated). */
  htmlSnapshot: string;
  /** Rolling one-paragraph episode summary, maintained by the AI. */
  episodeSummary: string;
  updatedAt: number;
}

export interface Interaction {
  id: string;
  windowId: string;
  seq: number;
  opKind: string;
  opPayload: unknown;
  resultSummary?: string;
  createdAt: number;
}

export interface Episode {
  id: string;
  /** 'app:<appId>' or 'global'. */
  scope: string;
  summary: string;
  salience: number;
  createdAt: number;
}

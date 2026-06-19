/** Desktop icon grid — shared by drag-snap and auto-arrange. */
export const GRID_ORIGIN = 16;
export const GRID_COL = 96;
export const GRID_ROW = 104;

/** Snap a free position to the nearest grid cell. */
export function snapToGrid(x: number, y: number): { x: number; y: number } {
  return {
    x: Math.max(8, GRID_ORIGIN + Math.round((x - GRID_ORIGIN) / GRID_COL) * GRID_COL),
    y: Math.max(8, GRID_ORIGIN + Math.round((y - GRID_ORIGIN) / GRID_ROW) * GRID_ROW),
  };
}

/** Position for the nth icon, filling columns top→bottom then wrapping right. */
export function gridPosition(index: number, viewportH: number): { x: number; y: number } {
  const usableH = Math.max(GRID_ROW, viewportH - 80 - GRID_ORIGIN); // leave room for the dock
  const perCol = Math.max(1, Math.floor(usableH / GRID_ROW));
  const col = Math.floor(index / perCol);
  const row = index % perCol;
  return { x: GRID_ORIGIN + col * GRID_COL, y: GRID_ORIGIN + row * GRID_ROW };
}

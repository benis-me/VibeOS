import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { ChevronRight, Check } from "lucide-react";
import { create } from "zustand";
import { cn } from "@/lib/utils";

/** One entry in an OS context menu. */
export type MenuItem =
  | {
      type: "item";
      label: string;
      icon?: ReactNode;
      shortcut?: string;
      checked?: boolean;
      disabled?: boolean;
      danger?: boolean;
      onSelect: () => void;
    }
  | { type: "submenu"; label: string; icon?: ReactNode; items: MenuItem[] }
  | { type: "separator" };

// ---------------------------------------------------------------------------
// Global store: there's exactly one open context menu at a time.
// ---------------------------------------------------------------------------
interface ContextMenuStore {
  open: boolean;
  x: number;
  y: number;
  items: MenuItem[];
  show: (x: number, y: number, items: MenuItem[]) => void;
  close: () => void;
}

const useContextMenuStore = create<ContextMenuStore>((set) => ({
  open: false,
  x: 0,
  y: 0,
  items: [],
  show: (x, y, items) => set({ open: true, x, y, items }),
  close: () => set({ open: false, items: [] }),
}));

/** Open a context menu at the event position. Suppresses the native menu. */
export function openContextMenu(e: React.MouseEvent, items: MenuItem[]): void {
  if (items.length === 0) return;
  e.preventDefault();
  e.stopPropagation();
  useContextMenuStore.getState().show(e.clientX, e.clientY, items);
}

// ---------------------------------------------------------------------------
// Geometry: the "safety triangle" — while the pointer heads toward an open
// submenu, sibling rows must not steal the hover. We treat each move as safe
// if the cursor stays inside the triangle from its previous position to the
// submenu's near vertical edge.
// ---------------------------------------------------------------------------
type Pt = { x: number; y: number };

function sign(a: Pt, b: Pt, c: Pt): number {
  return (a.x - c.x) * (b.y - c.y) - (b.x - c.x) * (a.y - c.y);
}

function inTriangle(p: Pt, a: Pt, b: Pt, c: Pt): boolean {
  const d1 = sign(p, a, b);
  const d2 = sign(p, b, c);
  const d3 = sign(p, c, a);
  const neg = d1 < 0 || d2 < 0 || d3 < 0;
  const pos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(neg && pos);
}

// ---------------------------------------------------------------------------
// A single menu panel (recursive — a submenu is another panel).
// ---------------------------------------------------------------------------
interface PanelProps {
  items: MenuItem[];
  x: number;
  y: number;
  onClose: () => void;
  /** Reports this panel's root element to the parent (for triangle measuring). */
  panelRef?: (el: HTMLDivElement | null) => void;
  /** Close this (sub)menu and return focus to the parent (ArrowLeft). */
  onBack?: () => void;
}

function MenuPanel({ items, x, y, onClose, panelRef, onBack }: PanelProps) {
  const selfRef = useRef<HTMLDivElement | null>(null);
  const subRef = useRef<HTMLDivElement | null>(null);
  const prev = useRef<Pt>({ x, y });
  const aiming = useRef(false);
  const hov = useRef<number | null>(null);
  const [pos, setPos] = useState<Pt>({ x, y });
  const [open, setOpen] = useState<{ idx: number; x: number; y: number } | null>(null);
  const [activeIdx, setActiveIdx] = useState(-1);

  // Focus the panel on mount so arrow keys work immediately (a submenu opened by
  // keyboard becomes the active panel; ArrowLeft returns focus to the parent).
  useEffect(() => {
    selfRef.current?.focus();
  }, []);

  // Keep the panel inside the viewport.
  useLayoutEffect(() => {
    const el = selfRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    let nx = x;
    let ny = y;
    if (x + r.width > window.innerWidth - 4) nx = Math.max(4, x - r.width);
    if (y + r.height > window.innerHeight - 4) ny = Math.max(4, window.innerHeight - r.height - 4);
    setPos((p) => (p.x === nx && p.y === ny ? p : { x: nx, y: ny }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [x, y]);

  const openSub = (idx: number, rowEl: HTMLElement) => {
    const item = items[idx];
    if (!item || item.type !== "submenu") {
      setOpen(null);
      return;
    }
    const row = rowEl.getBoundingClientRect();
    const self = selfRef.current!.getBoundingClientRect();
    const EST_W = 200;
    let sx = self.right - 4;
    if (sx + EST_W > window.innerWidth) sx = Math.max(4, self.left - EST_W + 4);
    setOpen({ idx, x: sx, y: row.top - 4 });
  };

  const onRowEnter = (idx: number, e: React.MouseEvent) => {
    hov.current = idx;
    setActiveIdx(idx);
    // If a submenu is open and we're aiming at it, defer — the move handler
    // switches once the pointer stops heading toward the submenu.
    if (open && open.idx !== idx && aiming.current) return;
    openSub(idx, e.currentTarget as HTMLElement);
  };

  const openSubByIdx = (idx: number) => {
    const rowEl = selfRef.current?.querySelector<HTMLElement>(`[data-idx="${idx}"]`);
    if (rowEl) openSub(idx, rowEl);
  };

  const moveActive = (dir: 1 | -1) => {
    const n = items.length;
    if (n === 0) return;
    let i = activeIdx;
    for (let step = 0; step < n; step++) {
      i = (i + dir + n) % n;
      const it = items[i];
      if (it && it.type !== "separator" && !(it.type === "item" && it.disabled)) {
        setActiveIdx(i);
        return;
      }
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const it = activeIdx >= 0 ? items[activeIdx] : undefined;
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        e.stopPropagation();
        moveActive(1);
        break;
      case "ArrowUp":
        e.preventDefault();
        e.stopPropagation();
        moveActive(-1);
        break;
      case "ArrowRight":
        if (it?.type === "submenu") {
          e.preventDefault();
          e.stopPropagation();
          openSubByIdx(activeIdx);
        }
        break;
      case "ArrowLeft":
        if (onBack) {
          e.preventDefault();
          e.stopPropagation();
          setOpen(null);
          onBack();
        }
        break;
      case "Enter":
      case " ":
        if (!it) break;
        e.preventDefault();
        e.stopPropagation();
        if (it.type === "submenu") openSubByIdx(activeIdx);
        else if (it.type === "item" && !it.disabled) {
          it.onSelect();
          onClose();
        }
        break;
    }
  };

  const onMove = (e: React.MouseEvent) => {
    const cur: Pt = { x: e.clientX, y: e.clientY };
    if (open && subRef.current) {
      const r = subRef.current.getBoundingClientRect();
      const apex = prev.current;
      const bx = r.left >= apex.x ? r.left : r.right; // near vertical edge
      aiming.current = inTriangle(cur, apex, { x: bx, y: r.top }, { x: bx, y: r.bottom });
    } else {
      aiming.current = false;
    }
    prev.current = cur;
    // Not aiming anymore + hovering a different row → switch to it.
    if (!aiming.current && hov.current != null && (!open || open.idx !== hov.current)) {
      const rowEl = selfRef.current?.querySelector<HTMLElement>(`[data-idx="${hov.current}"]`);
      if (rowEl) openSub(hov.current, rowEl);
    }
  };

  const onClick = (item: MenuItem, idx: number, e: React.MouseEvent) => {
    if (item.type === "separator") return;
    if (item.type === "submenu") {
      openSub(idx, e.currentTarget as HTMLElement);
      return;
    }
    if (item.disabled) return;
    item.onSelect();
    onClose();
  };

  const sub = open && items[open.idx]?.type === "submenu" ? (items[open.idx] as Extract<MenuItem, { type: "submenu" }>) : null;

  return (
    <div
      ref={(el) => {
        selfRef.current = el;
        panelRef?.(el);
      }}
      className="vibe-menu outline-none"
      role="menu"
      tabIndex={-1}
      style={{ left: pos.x, top: pos.y }}
      onMouseMove={onMove}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, idx) => {
        if (item.type === "separator") return <div key={idx} className="vibe-menu-sep" role="separator" />;
        const isSub = item.type === "submenu";
        const disabled = item.type === "item" && item.disabled;
        return (
          <button
            key={idx}
            data-idx={idx}
            role="menuitem"
            data-active={open?.idx === idx || activeIdx === idx ? "true" : undefined}
            data-disabled={disabled ? "true" : undefined}
            data-danger={item.type === "item" && item.danger ? "true" : undefined}
            className={cn("vibe-menu-item")}
            onMouseEnter={(e) => onRowEnter(idx, e)}
            onMouseLeave={() => {
              if (hov.current === idx) hov.current = null;
            }}
            onClick={(e) => onClick(item, idx, e)}
          >
            <span className="vibe-menu-icon">{item.icon}</span>
            <span className="vibe-menu-label">{item.label}</span>
            <span className="vibe-menu-right">
              {isSub ? (
                <ChevronRight size={13} />
              ) : item.type === "item" && item.checked ? (
                <Check size={13} />
              ) : item.type === "item" && item.shortcut ? (
                item.shortcut
              ) : null}
            </span>
          </button>
        );
      })}

      {sub && (
        <MenuPanel
          items={sub.items}
          x={open!.x}
          y={open!.y}
          onClose={onClose}
          panelRef={(el) => (subRef.current = el)}
          onBack={() => {
            setOpen(null);
            selfRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}

/** Mounted once near the desktop root. Renders the active menu via a portal. */
export function ContextMenuRoot() {
  const { open, x, y, items, close } = useContextMenuStore();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement)?.closest?.(".vibe-menu")) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    const onBlur = () => close();
    document.addEventListener("pointerdown", onDown, true);
    document.addEventListener("keydown", onKey);
    window.addEventListener("blur", onBlur);
    return () => {
      document.removeEventListener("pointerdown", onDown, true);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("blur", onBlur);
    };
  }, [open, close]);

  if (!open) return null;
  return createPortal(<MenuPanel items={items} x={x} y={y} onClose={close} />, document.body);
}

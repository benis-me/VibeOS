import {
  Globe,
  Terminal,
  FolderSimple,
  GearSix,
  Pulse,
  Storefront,
  TrashSimple,
  Calculator,
  MusicNote,
  Envelope,
  Image,
  Calendar,
  MapTrifold,
  GameController,
  NotePencil,
  CloudSun,
  Palette,
  PaintBrush,
  AppWindow,
  FileText,
  ChatCircle,
  Camera,
  Clock,
  Star,
  Heart,
  User,
  MagnifyingGlass,
  Bell,
  VideoCamera,
  BookOpen,
  ShoppingCart,
  Code,
  Database,
  ChartBar,
  Compass,
  House,
  Wrench,
  Cloud,
  Sun,
  Moon,
  type Icon,
} from "@phosphor-icons/react";
import type { PresetAppId } from "@vibeos/shared";
import { cn } from "@/lib/utils";

/** Built-in apps have FIXED icons defined here in code — never from the DB. */
const PRESET_ICONS: Record<PresetAppId, Icon> = {
  browser: Globe,
  "command-line": Terminal,
  "file-manager": FolderSimple,
  settings: GearSix,
  "activity-monitor": Pulse,
  "app-store": Storefront,
  "recycle-bin": TrashSimple,
};

/** Maps the (lucide-style) icon names the AI emits onto Phosphor icons. */
const ICONS: Record<string, Icon> = {
  globe: Globe,
  browser: Globe,
  terminal: Terminal,
  "square-terminal": Terminal,
  folder: FolderSimple,
  files: FolderSimple,
  settings: GearSix,
  gear: GearSix,
  calculator: Calculator,
  music: MusicNote,
  "music-note": MusicNote,
  mail: Envelope,
  envelope: Envelope,
  image: Image,
  photo: Image,
  calendar: Calendar,
  map: MapTrifold,
  "gamepad-2": GameController,
  gamepad: GameController,
  "notebook-pen": NotePencil,
  notes: NotePencil,
  "note-pencil": NotePencil,
  "cloud-sun": CloudSun,
  weather: CloudSun,
  palette: Palette,
  paint: Palette,
  "paint-brush": PaintBrush,
  "app-window": AppWindow,
  "file-text": FileText,
  file: FileText,
  chat: ChatCircle,
  "message-circle": ChatCircle,
  messages: ChatCircle,
  camera: Camera,
  clock: Clock,
  star: Star,
  heart: Heart,
  user: User,
  search: MagnifyingGlass,
  bell: Bell,
  video: VideoCamera,
  "video-camera": VideoCamera,
  book: BookOpen,
  "book-open": BookOpen,
  "shopping-cart": ShoppingCart,
  store: Storefront,
  code: Code,
  database: Database,
  chart: ChartBar,
  "chart-bar": ChartBar,
  compass: Compass,
  home: House,
  house: House,
  wrench: Wrench,
  cloud: Cloud,
  sun: Sun,
  moon: Moon,
};

interface Props {
  /** Icon name the AI emitted (kebab-case), used for virtual apps. */
  name?: string;
  /** Preset app id — its icon is fixed in code and wins over `name`. */
  presetId?: PresetAppId;
  /** Fallback label for a monogram when the icon is unknown. */
  label?: string;
  className?: string;
}

/**
 * Renders an app icon as a Phosphor **duotone** glyph. Built-in apps use a fixed
 * code-defined icon; AI apps map their emitted name onto Phosphor; anything
 * unknown falls back to a 1-2 letter monogram (never emoji).
 */
export function AppIcon({ name, presetId, label, className }: Props) {
  const Cmp = (presetId && PRESET_ICONS[presetId]) || (name ? ICONS[name.toLowerCase()] : undefined);
  if (Cmp) return <Cmp weight="duotone" className={cn("size-5", className)} />;

  const monogram =
    (label ?? name ?? "?").replace(/[^A-Za-z0-9]/g, "").slice(0, 2).toUpperCase() || "?";
  return (
    <span
      className={cn(
        "inline-flex size-5 items-center justify-center rounded-[5px] bg-muted text-[10px] font-semibold text-muted-foreground",
        className,
      )}
    >
      {monogram}
    </span>
  );
}

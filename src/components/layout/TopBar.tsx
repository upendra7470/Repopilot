import clsx from "clsx";
import { Menu, Search, Bell } from "lucide-react";

interface TopBarProps {
  onMenuToggle?: () => void;
  onCommandOpen?: () => void;
}

export function TopBar({ onMenuToggle, onCommandOpen }: TopBarProps) {
  return (
    <header className="flex items-center justify-between h-14 px-4 border-b border-border-primary bg-bg-secondary/80 backdrop-blur-md flex-shrink-0">
      {/* Left: mobile menu + breadcrumb */}
      <div className="flex items-center gap-3">
        <button
          onClick={onMenuToggle}
          className="p-1.5 rounded-md text-text-muted hover:text-text-secondary hover:bg-bg-hover transition-colors md:hidden"
          aria-label="Toggle menu"
        >
          <Menu size={18} />
        </button>
        <nav className="flex items-center gap-1.5 text-sm">
          <span className="text-text-muted">nexuspay-platform</span>
          <span className="text-text-muted">/</span>
          <span className="text-text-primary font-medium">Overview</span>
        </nav>
      </div>

      {/* Center: search/command trigger */}
      <button
        onClick={onCommandOpen}
        className={clsx(
          "hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-lg",
          "bg-bg-tertiary border border-border-primary",
          "text-text-muted text-sm",
          "hover:border-border-secondary hover:text-text-secondary",
          "transition-colors"
        )}
      >
        <Search size={14} />
        <span>Search or press</span>
        <kbd className="px-1.5 py-0.5 text-[11px] font-mono bg-bg-hover rounded text-text-muted border border-border-secondary">
          ⌘K
        </kbd>
      </button>

      {/* Right: notifications + avatar */}
      <div className="flex items-center gap-2">
        <button
          className="p-1.5 rounded-md text-text-muted hover:text-text-secondary hover:bg-bg-hover transition-colors relative"
          aria-label="Notifications"
        >
          <Bell size={18} />
          <span className="absolute top-1 right-1 w-2 h-2 bg-danger rounded-full" />
        </button>
        <div className="w-7 h-7 rounded-full bg-accent/20 flex items-center justify-center ml-1">
          <span className="text-xs font-medium text-accent">SC</span>
        </div>
      </div>
    </header>
  );
}

import clsx from "clsx";
import { Menu, Search, Bell, LogOut } from "lucide-react";
import { useLocation } from "react-router-dom";
import { useAuth } from "../../auth/useAuth";

/** Truthful breadcrumb derived from the current route — never hardcoded. */
const ROUTE_LABELS: Record<string, string> = {
  overview: "Overview",
  risks: "Risks",
  "pull-requests": "PR Intelligence",
  issues: "Issues",
  "ci-cd": "CI/CD",
  incidents: "Incidents",
  timeline: "Timeline",
  contributors: "Contributors",
  components: "Components",
  "knowledge-graph": "Knowledge Graph",
  repository: "Repositories",
  ask: "Ask RepoPilot",
  settings: "Settings",
  login: "Sign in",
};

function useBreadcrumb(): string {
  const { pathname } = useLocation();
  const segments = pathname.split("/").filter(Boolean);
  const [section, detail] = segments;
  const label = (section && ROUTE_LABELS[section]) || "RepoPilot";
  return detail ? `${label} / Details` : label;
}

interface TopBarProps {
  onMenuToggle?: () => void;
  onCommandOpen?: () => void;
}

function UserInitials({ login }: { login: string }) {
  return <>{login.slice(0, 2).toUpperCase()}</>;
}

export function TopBar({ onMenuToggle, onCommandOpen }: TopBarProps) {
  const { user, logout } = useAuth();
  const breadcrumb = useBreadcrumb();

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
        <nav className="flex items-center gap-1.5 text-sm" aria-label="Breadcrumb">
          <span className="text-text-primary font-medium">{breadcrumb}</span>
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

      {/* Right: notifications + identity + sign out */}
      <div className="flex items-center gap-2">
        <button
          className="p-1.5 rounded-md text-text-muted hover:text-text-secondary hover:bg-bg-hover transition-colors relative"
          aria-label="Notifications"
        >
          <Bell size={18} />
          <span className="absolute top-1 right-1 w-2 h-2 bg-danger rounded-full" />
        </button>
        {user && (
          <div className="flex items-center gap-2 ml-1">
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.login}
                className="w-7 h-7 rounded-full"
              />
            ) : (
              <div className="w-7 h-7 rounded-full bg-accent/20 flex items-center justify-center">
                <span className="text-xs font-medium text-accent">
                  <UserInitials login={user.login} />
                </span>
              </div>
            )}
            <span className="hidden md:inline text-sm text-text-secondary max-w-32 truncate">
              {user.login}
            </span>
            <button
              onClick={() => void logout()}
              className="p-1.5 rounded-md text-text-muted hover:text-text-secondary hover:bg-bg-hover transition-colors"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut size={16} />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

import clsx from "clsx";
import { Menu, Search, Bell, LogOut, Sun, Moon } from "lucide-react";
import { useEffect, useState } from "react";
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

function useTheme(): ['dark' | 'light', () => void] {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    if (typeof window === 'undefined') return 'dark';
    return (window.localStorage.getItem('repopilot-theme') as 'dark' | 'light') || 'dark';
  });
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      window.localStorage.setItem('repopilot-theme', theme);
    } catch {
      /* storage unavailable — theme still applies for the session */
    }
  }, [theme]);
  return [theme, () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'))];
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
  const [theme, toggleTheme] = useTheme();

  return (
    <header className="flex h-12 flex-shrink-0 items-center justify-between border-b border-border-primary bg-bg-secondary px-3">
      {/* Left: mobile menu + breadcrumb */}
      <div className="flex min-w-0 items-center gap-2">
        <button
          onClick={onMenuToggle}
          className="rounded border border-transparent p-1.5 text-text-muted transition-colors hover:border-border-primary hover:text-text-secondary md:hidden"
          aria-label="Toggle menu"
        >
          <Menu size={16} />
        </button>
        <nav className="flex min-w-0 items-center gap-1.5 text-[13px]" aria-label="Breadcrumb">
          <span className="truncate font-medium text-text-primary">{breadcrumb}</span>
        </nav>
      </div>

      {/* Center: search/command trigger */}
      <button
        onClick={onCommandOpen}
        className={clsx(
          "hidden items-center gap-2 rounded border border-border-primary bg-bg-tertiary px-2.5 py-1",
          "text-xs text-text-muted",
          "transition-colors hover:border-border-secondary hover:text-text-secondary",
          "sm:flex"
        )}
      >
        <Search size={13} />
        <span className="font-mono">Search</span>
        <kbd className="rounded border border-border-secondary bg-bg-hover px-1 py-px font-mono text-[10px] text-text-muted">
          ⌘K
        </kbd>
      </button>

      {/* Right: theme + notifications + identity + sign out */}
      <div className="flex items-center gap-1">
        <button
          onClick={toggleTheme}
          className="rounded border border-transparent p-1.5 text-text-muted transition-colors hover:border-border-primary hover:text-text-secondary"
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={theme === 'dark' ? 'Light theme' : 'Dark theme'}
        >
          {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
        </button>
        <button
          className="relative rounded border border-transparent p-1.5 text-text-muted transition-colors hover:border-border-primary hover:text-text-secondary"
          aria-label="Notifications"
        >
          <Bell size={15} />
          <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-danger" />
        </button>
        {user && (
          <div className="ml-1 flex items-center gap-2 border-l border-border-primary pl-2">
            {user.avatarUrl ? (
              <img
                src={user.avatarUrl}
                alt={user.login}
                className="h-6 w-6 rounded-full"
              />
            ) : (
              <div className="flex h-6 w-6 items-center justify-center rounded-full border border-accent/30 bg-accent-muted">
                <span className="font-mono text-[10px] font-semibold text-accent">
                  <UserInitials login={user.login} />
                </span>
              </div>
            )}
            <span className="hidden max-w-32 truncate font-mono text-xs text-text-secondary md:inline">
              {user.login}
            </span>
            <button
              onClick={() => void logout()}
              className="rounded border border-transparent p-1.5 text-text-muted transition-colors hover:border-border-primary hover:text-text-secondary"
              aria-label="Sign out"
              title="Sign out"
            >
              <LogOut size={14} />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}

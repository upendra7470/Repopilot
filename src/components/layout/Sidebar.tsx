import { useEffect, useCallback, useState } from "react";
import { createPortal } from "react-dom";
import clsx from "clsx";
import {
  LayoutDashboard,
  ShieldAlert,
  GitPullRequest,
  AlertCircle,
  Activity,
  AlertTriangle,
  Clock,
  Users,
  Boxes,
  BrainCircuit,
  FolderGit2,
  Sparkles,
  Settings,
  ChevronLeft,
  ChevronRight,
  X,
} from "lucide-react";
import { api, type ConnectedRepo } from "../../lib/api/client";

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  onClose?: () => void;
  activeRoute: string;
  onNavigate: (route: string) => void;
}

interface NavItem {
  id: string;
  label: string;
  icon: React.ElementType;
  /** Active = backed by real API data. Soon = honest placeholder, no fake data. */
  status: 'active' | 'soon';
}

interface NavSection {
  title?: string;
  items: NavItem[];
}

const sections: NavSection[] = [
  {
    items: [{ id: 'overview', label: 'Overview', icon: LayoutDashboard, status: 'active' }],
  },
  {
    title: 'Engineering Intelligence',
    items: [
      { id: 'risks', label: 'Risks', icon: ShieldAlert, status: 'active' },
      { id: 'pull-requests', label: 'PR Intelligence', icon: GitPullRequest, status: 'active' },
      { id: 'issues', label: 'Issues', icon: AlertCircle, status: 'active' },
      { id: 'ci-cd', label: 'CI/CD', icon: Activity, status: 'soon' },
      { id: 'incidents', label: 'Incidents', icon: AlertTriangle, status: 'soon' },
    ],
  },
  {
    title: 'Engineering Memory',
    items: [
      { id: 'timeline', label: 'Timeline', icon: Clock, status: 'active' },
      { id: 'contributors', label: 'Contributors', icon: Users, status: 'active' },
      { id: 'components', label: 'Components', icon: Boxes, status: 'soon' },
      { id: 'knowledge-graph', label: 'Knowledge Graph', icon: BrainCircuit, status: 'soon' },
    ],
  },
  {
    title: 'Repository',
    items: [
      { id: 'repository', label: 'Repositories', icon: FolderGit2, status: 'active' },
    ],
  },
];

/**
 * Workspace selector backed by the authenticated user's real connected
 * repositories. Never falls back to demo data: loading shows a placeholder,
 * empty shows a connect affordance, failure shows a neutral entry — all
 * navigating to the real repository flow.
 */
function WorkspaceSelector({
  collapsed,
  onNavigate,
}: {
  collapsed: boolean;
  onNavigate: (route: string) => void;
}) {
  const [repos, setRepos] = useState<ConnectedRepo[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    void api.listConnectedRepositories().then(
      (list) => {
        if (!cancelled) setRepos(list);
      },
      () => {
        if (!cancelled) setRepos([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const primary = repos && repos.length > 0 ? repos[0] : null;
  const target = primary ? `repository/${primary.id}` : "repository";
  const initial = primary ? primary.name.charAt(0).toUpperCase() : "R";
  const title = primary ? primary.name : repos === null ? "…" : "No repository";
  const subtitle = primary
    ? primary.fullName
    : repos === null
      ? "Loading…"
      : "Connect one to start";

  const body = (
    <>
      <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border border-accent/30 bg-accent-muted">
        <span className="text-[10px] font-semibold text-accent">{initial}</span>
      </div>
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-mono text-xs font-medium text-text-primary">
          {title}
        </span>
        <span className="truncate text-[10px] text-text-muted">{subtitle}</span>
      </div>
    </>
  );

  if (collapsed) {
    return (
      <div className="border-b border-border-primary px-3 py-3">
        <button
          onClick={() => onNavigate(target)}
          className="mx-auto flex h-8 w-8 items-center justify-center rounded border border-accent/30 bg-accent-muted transition-colors hover:bg-accent/25"
          aria-label={primary ? `Open ${primary.fullName}` : "Go to repositories"}
        >
          <span className="text-xs font-semibold text-accent">{initial}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="border-b border-border-primary px-3 py-3">
      <button
        onClick={() => onNavigate(target)}
        aria-label={primary ? `Open ${primary.fullName}` : "Go to repositories"}
        className="flex w-full items-center gap-2 rounded border border-border-primary bg-bg-tertiary px-2 py-1.5 text-left transition-colors hover:border-border-secondary"
      >
        {body}
      </button>
    </div>
  );
}

function SidebarInner({
  collapsed,
  onToggle,
  onClose,
  activeRoute,
  onNavigate,
}: SidebarProps) {
  return (
    <div
      className={clsx(
        "flex h-full flex-col border-r border-border-primary bg-bg-secondary",
        "transition-[width] duration-200 ease-out",
        collapsed ? "w-[64px]" : "w-[240px]"
      )}
    >
      {/* Brand */}
      <div className="flex h-12 items-center justify-between border-b border-border-primary px-3">
        {!collapsed && (
          <button
            onClick={() => onNavigate('overview')}
            className="flex items-center gap-2"
            aria-label="RepoPilot home"
          >
            <div className="flex h-6 w-6 items-center justify-center rounded border border-accent/40 bg-accent-muted">
              <svg
                width="13"
                height="13"
                viewBox="0 0 16 16"
                fill="none"
                className="text-accent"
              >
                <path
                  d="M3 3h4.5v10H3V3zm5.5 0H13v4.5H8.5V3zM8.5 9H13v4.5H8.5V9z"
                  fill="currentColor"
                />
              </svg>
            </div>
            <span className="text-[13px] font-semibold tracking-tight text-text-primary">
              RepoPilot
            </span>
          </button>
        )}
        {collapsed && (
          <button
            onClick={() => onNavigate('overview')}
            className="mx-auto flex h-6 w-6 items-center justify-center rounded border border-accent/40 bg-accent-muted"
            aria-label="RepoPilot home"
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 16 16"
              fill="none"
              className="text-accent"
            >
              <path
                d="M3 3h4.5v10H3V3zm5.5 0H13v4.5H8.5V3zM8.5 9H13v4.5H8.5V9z"
                fill="currentColor"
              />
            </svg>
          </button>
        )}
        {!collapsed && (
          <button
            onClick={onToggle}
            className="rounded border border-transparent p-1 text-text-muted transition-colors hover:border-border-primary hover:text-text-secondary"
            aria-label="Collapse sidebar"
          >
            <ChevronLeft size={15} />
          </button>
        )}
      </div>

      {/* Repository selector */}
      <WorkspaceSelector collapsed={collapsed} onNavigate={onNavigate} />

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto px-2 py-2" aria-label="Primary">
        {sections.map((section, sectionIdx) => (
          <div key={sectionIdx} className="mb-3">
            {section.title && !collapsed && (
              <div className="mb-1 px-2 text-[10px] font-semibold uppercase tracking-wider text-text-muted">
                {section.title}
              </div>
            )}
            <div className="space-y-px">
              {section.items.map((item) => {
                const Icon = item.icon;
                const isActive = activeRoute === item.id;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      onNavigate(item.id);
                      onClose?.();
                    }}
                    className={clsx(
                      "relative flex w-full items-center gap-2 rounded border border-transparent transition-colors",
                      collapsed ? "justify-center px-2 py-2" : "px-2 py-1.5",
                      isActive
                        ? "border-border-secondary bg-bg-tertiary text-text-primary"
                        : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                    )}
                    title={collapsed ? item.label : undefined}
                    aria-current={isActive ? 'page' : undefined}
                  >
                    {isActive && (
                      <span className="absolute left-0 top-1/2 h-4 w-0.5 -translate-y-1/2 rounded-r bg-accent" />
                    )}
                    <Icon
                      size={15}
                      className={clsx(
                        "flex-shrink-0",
                        isActive ? "text-accent" : ""
                      )}
                    />
                    {!collapsed && (
                      <span className="truncate text-[13px] font-medium">
                        {item.label}
                      </span>
                    )}
                    {!collapsed && item.status === 'soon' && (
                      <span className="ml-auto rounded border border-border-primary bg-bg-inset px-1 py-px text-[9px] font-semibold uppercase tracking-wider text-text-muted">
                        Soon
                      </span>
                    )}
                    {collapsed && item.status === 'soon' && (
                      <span
                        className="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-text-muted"
                        aria-label={`${item.label} coming soon`}
                      />
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom actions */}
      <div className="space-y-px border-t border-border-primary px-2 py-2">
        <button
          onClick={() => {
            onNavigate('ask');
            onClose?.();
          }}
          className={clsx(
            "flex w-full items-center gap-2 rounded border border-transparent px-2 py-1.5 text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary",
            collapsed && "justify-center",
            activeRoute === 'ask' && "border-border-secondary bg-bg-tertiary text-text-primary"
          )}
          title={collapsed ? "Ask RepoPilot" : undefined}
        >
          <Sparkles size={15} className="flex-shrink-0 text-text-muted" />
          {!collapsed && (
            <>
              <span className="truncate text-[13px] font-medium">Ask RepoPilot</span>
              <span className="ml-auto rounded border border-border-primary bg-bg-inset px-1 py-px text-[9px] font-semibold uppercase tracking-wider text-text-muted">
                Soon
              </span>
            </>
          )}
        </button>
        <button
          onClick={() => {
            onNavigate('settings');
            onClose?.();
          }}
          className={clsx(
            "flex w-full items-center gap-2 rounded border border-transparent px-2 py-1.5 text-text-secondary transition-colors hover:bg-bg-hover hover:text-text-primary",
            collapsed && "justify-center",
            activeRoute === 'settings' && "border-border-secondary bg-bg-tertiary text-text-primary"
          )}
          title={collapsed ? "Settings" : undefined}
        >
          <Settings size={15} className="flex-shrink-0" />
          {!collapsed && (
            <span className="truncate text-[13px] font-medium">Settings</span>
          )}
        </button>
      </div>

      {/* Expand button when collapsed (desktop only) */}
      {collapsed && (
        <div className="border-t border-border-primary px-2 py-2">
          <button
            onClick={onToggle}
            className="w-full flex items-center justify-center p-1.5 rounded-md text-text-muted hover:text-text-secondary hover:bg-bg-hover transition-colors"
          >
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = useState(
    () => window.innerWidth < breakpoint
  );

  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < breakpoint);
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, [breakpoint]);

  return isMobile;
}

export function Sidebar({
  collapsed,
  onToggle,
  activeRoute,
  onNavigate,
}: SidebarProps) {
  const isMobile = useIsMobile();

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape" && !collapsed) {
        onToggle();
      }
    },
    [collapsed, onToggle]
  );

  useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const handleClose = useCallback(() => {
    if (isMobile && !collapsed) {
      onToggle();
    }
  }, [isMobile, collapsed, onToggle]);

  // Mobile: slide-in overlay
  if (isMobile) {
    return createPortal(
      <>
        <div
          className={clsx(
            "fixed inset-0 bg-black/50 z-40 backdrop-blur-sm transition-opacity",
            collapsed ? "opacity-0 pointer-events-none" : "opacity-100"
          )}
          onClick={onToggle}
          aria-hidden="true"
        />
        <div
          className={clsx(
            "fixed top-0 left-0 h-full z-50 transform transition-transform duration-200 ease-out",
            collapsed ? "-translate-x-full" : "translate-x-0"
          )}
          role="dialog"
          aria-modal="true"
        >
          <SidebarInner
            collapsed={false}
            onToggle={onToggle}
            onClose={handleClose}
            activeRoute={activeRoute}
            onNavigate={onNavigate}
          />
          <button
            onClick={onToggle}
            className="absolute top-4 right-3 p-1 rounded-md text-text-muted hover:text-text-secondary hover:bg-bg-hover transition-colors"
            aria-label="Close sidebar"
          >
            <X size={16} />
          </button>
        </div>
      </>,
      document.body
    );
  }

  // Desktop: inline sidebar
  return (
    <div className="flex-shrink-0">
      <SidebarInner
        collapsed={collapsed}
        onToggle={onToggle}
        activeRoute={activeRoute}
        onNavigate={onNavigate}
      />
    </div>
  );
}

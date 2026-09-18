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
}

interface NavSection {
  title?: string;
  items: NavItem[];
}

const sections: NavSection[] = [
  {
    items: [{ id: "overview", label: "Overview", icon: LayoutDashboard }],
  },
  {
    title: "ENGINEERING INTELLIGENCE",
    items: [
      { id: "risks", label: "Risks", icon: ShieldAlert },
      { id: "pr-intelligence", label: "PR Intelligence", icon: GitPullRequest },
      { id: "issues", label: "Issues", icon: AlertCircle },
      { id: "ci-cd", label: "CI/CD", icon: Activity },
      { id: "incidents", label: "Incidents", icon: AlertTriangle },
    ],
  },
  {
    title: "ENGINEERING MEMORY",
    items: [
      { id: "timeline", label: "Timeline", icon: Clock },
      { id: "contributors", label: "Contributors", icon: Users },
      { id: "components", label: "Components", icon: Boxes },
      { id: "knowledge-graph", label: "Knowledge Graph", icon: BrainCircuit },
    ],
  },
  {
    title: "REPOSITORY",
    items: [
      { id: "repository", label: "Repositories", icon: FolderGit2 },
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
      <div className="w-5 h-5 rounded bg-accent/15 flex items-center justify-center flex-shrink-0">
        <span className="text-[10px] font-medium text-accent">{initial}</span>
      </div>
      <div className="flex flex-col min-w-0">
        <span className="text-xs font-medium text-text-primary truncate">
          {title}
        </span>
        <span className="text-[10px] text-text-muted truncate">{subtitle}</span>
      </div>
    </>
  );

  if (collapsed) {
    return (
      <div className="px-3 py-3 border-b border-border-primary">
        <button
          onClick={() => onNavigate(target)}
          className="w-8 h-8 rounded-md bg-accent/15 flex items-center justify-center mx-auto hover:bg-accent/25 transition-colors"
          aria-label={primary ? `Open ${primary.fullName}` : "Go to repositories"}
        >
          <span className="text-xs font-medium text-accent">{initial}</span>
        </button>
      </div>
    );
  }

  return (
    <div className="px-3 py-3 border-b border-border-primary">
      <button
        onClick={() => onNavigate(target)}
        aria-label={primary ? `Open ${primary.fullName}` : "Go to repositories"}
        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md bg-bg-tertiary hover:bg-bg-hover transition-colors text-left"
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
        "flex flex-col h-full bg-bg-secondary border-r border-border-primary",
        "transition-all duration-200 ease-out",
        collapsed ? "w-[64px]" : "w-[240px]"
      )}
    >
      {/* Brand */}
      <div className="flex items-center justify-between h-14 px-4 border-b border-border-primary">
        {!collapsed && (
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-accent flex items-center justify-center">
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                className="text-white"
              >
                <path
                  d="M3 3h4.5v10H3V3zm5.5 0H13v4.5H8.5V3zM8.5 9H13v4.5H8.5V9z"
                  fill="currentColor"
                />
              </svg>
            </div>
            <span className="text-sm font-semibold text-text-primary tracking-tight">
              RepoPilot
            </span>
          </div>
        )}
        {collapsed && (
          <div className="w-7 h-7 rounded-md bg-accent flex items-center justify-center mx-auto">
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              className="text-white"
            >
              <path
                d="M3 3h4.5v10H3V3zm5.5 0H13v4.5H8.5V3zM8.5 9H13v4.5H8.5V9z"
                fill="currentColor"
              />
            </svg>
          </div>
        )}
        {!collapsed && (
          <button
            onClick={onToggle}
            className="p-1 rounded-md text-text-muted hover:text-text-secondary hover:bg-bg-hover transition-colors"
          >
            <ChevronLeft size={16} />
          </button>
        )}
      </div>

      {/* Repository selector */}
      <WorkspaceSelector collapsed={collapsed} onNavigate={onNavigate} />

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2 px-2">
        {sections.map((section, sectionIdx) => (
          <div key={sectionIdx} className="mb-3">
            {section.title && !collapsed && (
              <div className="px-2 mb-1 text-[10px] font-semibold text-text-muted tracking-wider uppercase">
                {section.title}
              </div>
            )}
            <div className="space-y-0.5">
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
                      "w-full flex items-center gap-2.5 rounded-md transition-colors relative group",
                      collapsed ? "justify-center px-2 py-2" : "px-2 py-1.5",
                      isActive
                        ? "bg-accent/10 text-text-primary"
                        : "text-text-secondary hover:bg-bg-hover hover:text-text-primary"
                    )}
                    title={collapsed ? item.label : undefined}
                  >
                    {isActive && (
                      <div className="absolute left-0 top-1/2 -translate-y-1/2 w-[2px] h-4 bg-accent rounded-r-full" />
                    )}
                    <Icon
                      size={16}
                      className={clsx(
                        "flex-shrink-0",
                        isActive ? "text-accent" : ""
                      )}
                    />
                    {!collapsed && (
                      <span className="text-[13px] font-medium truncate">
                        {item.label}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* Bottom actions */}
      <div className="border-t border-border-primary px-2 py-2 space-y-0.5">
        <button
          className={clsx(
            "w-full flex items-center gap-2.5 rounded-md px-2 py-1.5 text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors",
            collapsed && "justify-center"
          )}
          title={collapsed ? "Ask RepoPilot" : undefined}
        >
          <Sparkles size={16} className="text-accent flex-shrink-0" />
          {!collapsed && (
            <span className="text-[13px] font-medium">Ask RepoPilot</span>
          )}
        </button>
        <button
          className={clsx(
            "w-full flex items-center gap-2.5 rounded-md px-2 py-1.5 text-text-secondary hover:bg-bg-hover hover:text-text-primary transition-colors",
            collapsed && "justify-center"
          )}
          title={collapsed ? "Settings" : undefined}
        >
          <Settings size={16} className="flex-shrink-0" />
          {!collapsed && (
            <span className="text-[13px] font-medium">Settings</span>
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

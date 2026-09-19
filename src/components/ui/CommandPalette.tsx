import { useState, useEffect, useRef, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Search, X } from "lucide-react";
import clsx from "clsx";

interface CommandItem {
  id: string;
  label: string;
  description?: string;
  section: string;
}

const commands: CommandItem[] = [
  { id: "overview", label: "Overview", section: "Navigation" },
  { id: "risks", label: "Risks", section: "Navigation" },
  { id: "pull-requests", label: "PR Intelligence", section: "Navigation" },
  { id: "issues", label: "Issues", section: "Navigation" },
  { id: "ci-cd", label: "CI/CD", section: "Navigation" },
  { id: "incidents", label: "Incidents", section: "Navigation" },
  { id: "timeline", label: "Timeline", section: "Memory" },
  { id: "contributors", label: "Contributors", section: "Memory" },
  { id: "components", label: "Components", section: "Memory" },
  { id: "knowledge-graph", label: "Knowledge Graph", section: "Memory" },
  { id: "repository", label: "Repositories", section: "Memory" },
  { id: "ask", label: "Ask RepoPilot", section: "AI" },
  { id: "settings", label: "Settings", section: "Settings" },
];

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();

  const filtered = commands.filter(
    (cmd) =>
      cmd.label.toLowerCase().includes(query.toLowerCase()) ||
      cmd.section.toLowerCase().includes(query.toLowerCase()),
  );

  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    const selected = listRef.current?.children[selectedIndex] as HTMLElement;
    selected?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const execute = useCallback(
    (cmd: CommandItem) => {
      onClose();
      navigate(`/${cmd.id}`);
    },
    [onClose, navigate],
  );

  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter" && filtered[selectedIndex]) {
        execute(filtered[selectedIndex]);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose, filtered, selectedIndex, execute]);

  if (!open) return null;

  let lastSection = "";

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      onClick={onClose}
    >
      <div className="fixed inset-0 bg-black/50" />
      <div
        className="relative w-full max-w-lg overflow-hidden border border-border-primary bg-bg-secondary"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border-primary">
          <Search size={16} className="text-text-muted flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelectedIndex(0);
            }}
            placeholder="Type a command..."
            className="flex-1 bg-transparent text-text-primary text-sm outline-none placeholder:text-text-muted"
          />
          <button
            onClick={onClose}
            className="p-1 rounded text-text-muted hover:text-text-secondary hover:bg-bg-hover transition-colors"
          >
            <X size={14} />
          </button>
        </div>
        <div ref={listRef} className="max-h-80 overflow-y-auto py-2">
          {filtered.length === 0 ? (
            <div className="px-4 py-8 text-center text-text-muted text-sm">
              No commands found
            </div>
          ) : (
            filtered.map((cmd, i) => {
              const showSection = cmd.section !== lastSection;
              lastSection = cmd.section;
              return (
                <div key={cmd.id}>
                  {showSection && (
                    <div className="px-4 py-1.5 text-[11px] font-medium text-text-muted uppercase tracking-wider">
                      {cmd.section}
                    </div>
                  )}
                  <button
                    onClick={() => execute(cmd)}
                    onMouseEnter={() => setSelectedIndex(i)}
                    className={clsx(
                      "w-full flex items-center gap-3 px-4 py-2 text-sm transition-colors text-left",
                      i === selectedIndex
                        ? "bg-accent/10 text-accent"
                        : "text-text-primary hover:bg-bg-hover",
                    )}
                  >
                    <span>{cmd.label}</span>
                    {cmd.description && (
                      <span className="ml-auto text-text-muted text-xs">
                        {cmd.description}
                      </span>
                    )}
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

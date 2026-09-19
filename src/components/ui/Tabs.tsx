import clsx from 'clsx'

interface TabsProps {
  tabs: { id: string; label: string; count?: number }[]
  activeTab: string
  onChange: (id: string) => void
}

export function Tabs({ tabs, activeTab, onChange }: TabsProps) {
  return (
    <div className="flex gap-0.5 border-b border-border-primary">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          aria-pressed={activeTab === tab.id}
          className={clsx(
            'relative flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium transition-colors',
            activeTab === tab.id
              ? 'text-text-primary'
              : 'text-text-muted hover:text-text-secondary'
          )}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span
              className={clsx(
                'rounded border px-1 py-px font-mono text-[10px] leading-3',
                activeTab === tab.id
                  ? 'border-accent/30 bg-accent-muted text-accent'
                  : 'border-border-primary bg-bg-tertiary text-text-muted'
              )}
            >
              {tab.count}
            </span>
          )}
          {activeTab === tab.id && (
            <span className="absolute inset-x-2 -bottom-px h-0.5 bg-accent" />
          )}
        </button>
      ))}
    </div>
  )
}

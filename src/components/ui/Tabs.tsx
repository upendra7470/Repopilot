import clsx from 'clsx'

interface TabsProps {
  tabs: { id: string; label: string; count?: number }[]
  activeTab: string
  onChange: (id: string) => void
}

export function Tabs({ tabs, activeTab, onChange }: TabsProps) {
  return (
    <div className="flex gap-1 border-b border-border-primary">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={clsx(
            'relative flex items-center gap-1.5 px-3 py-2.5 text-sm font-medium transition-colors',
            activeTab === tab.id
              ? 'text-text-primary'
              : 'text-text-muted hover:text-text-secondary'
          )}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span
              className={clsx(
                'rounded-full px-1.5 py-0.5 text-[10px] font-medium',
                activeTab === tab.id
                  ? 'bg-accent-muted text-accent'
                  : 'bg-bg-tertiary text-text-muted'
              )}
            >
              {tab.count}
            </span>
          )}
          {activeTab === tab.id && (
            <span className="absolute bottom-0 left-0 right-0 h-px bg-accent" />
          )}
        </button>
      ))}
    </div>
  )
}

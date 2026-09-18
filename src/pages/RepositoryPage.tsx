import { useState } from 'react'
import { GitBranch, GitCommit, FileText, Folder, FolderOpen, Star, GitFork, AlertCircle, Clock } from 'lucide-react'
import clsx from 'clsx'
import { Tabs } from '../components/ui/Tabs'
import { StatusBadge } from '../components/ui/StatusBadge'
import { demoRepository } from '../data/demo'

interface FileNode {
  name: string
  type: 'file' | 'folder'
  children?: FileNode[]
  size?: string
  lastModified?: string
}

interface Commit {
  hash: string
  message: string
  author: string
  date: string
  additions: number
  deletions: number
}

interface Branch {
  name: string
  isDefault: boolean
  lastCommit: string
  ahead: number
  behind: number
  status: 'clean' | 'ahead' | 'behind' | 'diverged'
}

const mockFileTree: FileNode[] = [
  {
    name: 'src',
    type: 'folder',
    children: [
      {
        name: 'payment-service',
        type: 'folder',
        children: [
          { name: 'index.ts', type: 'file', size: '2.4 KB', lastModified: '2 hours ago' },
          { name: 'processor.ts', type: 'file', size: '15.2 KB', lastModified: '1 day ago' },
          { name: 'retry.ts', type: 'file', size: '8.7 KB', lastModified: '3 hours ago' },
          { name: 'queue.ts', type: 'file', size: '6.1 KB', lastModified: '3 hours ago' },
        ],
      },
      {
        name: 'api-gateway',
        type: 'folder',
        children: [
          { name: 'index.ts', type: 'file', size: '1.8 KB', lastModified: '5 hours ago' },
          { name: 'router.ts', type: 'file', size: '12.3 KB', lastModified: '2 days ago' },
          { name: 'middleware.ts', type: 'file', size: '4.5 KB', lastModified: '1 week ago' },
        ],
      },
      {
        name: 'shared',
        type: 'folder',
        children: [
          { name: 'types.ts', type: 'file', size: '3.2 KB', lastModified: '3 days ago' },
          { name: 'utils.ts', type: 'file', size: '5.6 KB', lastModified: '1 week ago' },
          { name: 'config.ts', type: 'file', size: '2.1 KB', lastModified: '2 weeks ago' },
        ],
      },
    ],
  },
  {
    name: 'tests',
    type: 'folder',
    children: [
      { name: 'payment.test.ts', type: 'file', size: '18.4 KB', lastModified: '1 day ago' },
      { name: 'gateway.test.ts', type: 'file', size: '12.7 KB', lastModified: '3 days ago' },
    ],
  },
  { name: 'package.json', type: 'file', size: '1.2 KB', lastModified: '1 week ago' },
  { name: 'tsconfig.json', type: 'file', size: '0.8 KB', lastModified: '1 month ago' },
  { name: 'README.md', type: 'file', size: '4.5 KB', lastModified: '2 weeks ago' },
]

const mockCommits: Commit[] = [
  {
    hash: 'a1b2c3d',
    message: 'feat: Add exponential backoff to payment retry logic',
    author: 'David Kim',
    date: '3 hours ago',
    additions: 245,
    deletions: 89,
  },
  {
    hash: 'e4f5g6h',
    message: 'fix: Resolve race condition in webhook delivery queue',
    author: 'Sarah Chen',
    date: '5 hours ago',
    additions: 87,
    deletions: 34,
  },
  {
    hash: 'i7j8k9l',
    message: 'feat: Add GraphQL subscriptions for real-time updates',
    author: 'Tom Nguyen',
    date: '1 day ago',
    additions: 423,
    deletions: 89,
  },
  {
    hash: 'm0n1o2p',
    message: 'chore: Upgrade Node.js from 20 LTS to 22 LTS',
    author: 'Marcus Johnson',
    date: '2 days ago',
    additions: 89,
    deletions: 67,
  },
  {
    hash: 'q3r4s5t',
    message: 'refactor: Migrate payment validation to Zod schemas',
    author: 'Sarah Chen',
    date: '3 days ago',
    additions: 189,
    deletions: 256,
  },
]

const mockBranches: Branch[] = [
  { name: 'main', isDefault: true, lastCommit: '3 hours ago', ahead: 0, behind: 0, status: 'clean' },
  { name: 'feature/payment-retry-v2', isDefault: false, lastCommit: '3 hours ago', ahead: 12, behind: 2, status: 'diverged' },
  { name: 'fix/webhook-race-condition', isDefault: false, lastCommit: '5 hours ago', ahead: 3, behind: 0, status: 'ahead' },
  { name: 'feature/graphql-subscriptions', isDefault: false, lastCommit: '1 day ago', ahead: 8, behind: 1, status: 'ahead' },
  { name: 'chore/nodejs-22-upgrade', isDefault: false, lastCommit: '2 days ago', ahead: 5, behind: 3, status: 'diverged' },
  { name: 'hotfix/android-auth-loop', isDefault: false, lastCommit: '1 week ago', ahead: 0, behind: 15, status: 'behind' },
]

function FileTree({ items, level = 0 }: { items: FileNode[]; level?: number }) {
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['src', 'src/payment-service']))

  const toggleFolder = (path: string) => {
    setExpandedFolders(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  return (
    <div className={clsx(level > 0 && 'ml-4 border-l border-border-primary pl-2')}>
      {items.map(item => {
        const path = item.name
        const isExpanded = expandedFolders.has(path)
        
        return (
          <div key={item.name}>
            <button
              onClick={() => item.type === 'folder' && toggleFolder(path)}
              className={clsx(
                'flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm transition-colors',
                'hover:bg-bg-hover text-text-secondary hover:text-text-primary'
              )}
            >
              {item.type === 'folder' ? (
                <>
                  {isExpanded ? <FolderOpen size={14} className="text-accent" /> : <Folder size={14} className="text-text-muted" />}
                  <span className="font-medium">{item.name}</span>
                </>
              ) : (
                <>
                  <FileText size={14} className="text-text-muted ml-5" />
                  <span>{item.name}</span>
                  {item.size && (
                    <span className="ml-auto text-xs text-text-muted">{item.size}</span>
                  )}
                </>
              )}
            </button>
            {item.type === 'folder' && isExpanded && item.children && (
              <FileTree items={item.children} level={level + 1} />
            )}
          </div>
        )
      })}
    </div>
  )
}

export function RepositoryPage() {
  const [activeTab, setActiveTab] = useState('files')

  const tabs = [
    { id: 'files', label: 'Files' },
    { id: 'commits', label: 'Commits', count: mockCommits.length },
    { id: 'branches', label: 'Branches', count: mockBranches.length },
  ]

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-text-primary">{demoRepository.name}</h1>
            <StatusBadge label="Public" variant="success" />
          </div>
          <p className="mt-1 text-sm text-text-secondary">{demoRepository.description}</p>
        </div>
      </div>

      <div className="flex items-center gap-6 text-sm text-text-muted">
        <div className="flex items-center gap-1.5">
          <div className="h-3 w-3 rounded-full bg-blue-500" />
          <span>{demoRepository.language}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <Star size={14} />
          <span>{demoRepository.stars.toLocaleString()}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <GitFork size={14} />
          <span>{demoRepository.forks}</span>
        </div>
        <div className="flex items-center gap-1.5">
          <AlertCircle size={14} />
          <span>{demoRepository.openIssues} open issues</span>
        </div>
        <div className="flex items-center gap-1.5">
          <GitBranch size={14} />
          <span>{demoRepository.defaultBranch}</span>
        </div>
      </div>

      <Tabs tabs={tabs} activeTab={activeTab} onChange={setActiveTab} />

      {activeTab === 'files' && (
        <div className="rounded-lg border border-border-primary bg-bg-secondary p-4">
          <FileTree items={mockFileTree} />
        </div>
      )}

      {activeTab === 'commits' && (
        <div className="space-y-2">
          {mockCommits.map(commit => (
            <div
              key={commit.hash}
              className="rounded-lg border border-border-primary bg-bg-secondary p-4 transition-colors hover:border-border-active"
            >
              <div className="flex items-start gap-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bg-tertiary text-text-muted">
                  <GitCommit size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-text-primary">{commit.message}</p>
                  <div className="mt-1 flex items-center gap-4 text-xs text-text-muted">
                    <span className="font-mono">{commit.hash}</span>
                    <span>{commit.author}</span>
                    <span>{commit.date}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  <span className="text-success">+{commit.additions}</span>
                  <span className="text-danger">-{commit.deletions}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'branches' && (
        <div className="space-y-2">
          {mockBranches.map(branch => (
            <div
              key={branch.name}
              className="rounded-lg border border-border-primary bg-bg-secondary p-4 transition-colors hover:border-border-active"
            >
              <div className="flex items-center gap-4">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-bg-tertiary text-text-muted">
                  <GitBranch size={14} />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-text-primary font-mono">{branch.name}</span>
                    {branch.isDefault && (
                      <StatusBadge label="default" variant="info" />
                    )}
                  </div>
                  <div className="mt-1 flex items-center gap-4 text-xs text-text-muted">
                    <div className="flex items-center gap-1.5">
                      <Clock size={12} />
                      <span>{branch.lastCommit}</span>
                    </div>
                    {branch.ahead > 0 && (
                      <span className="text-success">+{branch.ahead} ahead</span>
                    )}
                    {branch.behind > 0 && (
                      <span className="text-danger">-{branch.behind} behind</span>
                    )}
                  </div>
                </div>
                <StatusBadge 
                  label={branch.status} 
                  variant={
                    branch.status === 'clean' ? 'success' :
                    branch.status === 'ahead' ? 'info' :
                    branch.status === 'behind' ? 'warning' : 'danger'
                  } 
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
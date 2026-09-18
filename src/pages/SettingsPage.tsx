import { useState } from 'react'
import { GitBranch, Bell, Palette, User, Save, ExternalLink } from 'lucide-react'
import clsx from 'clsx'
import { StatusBadge } from '../components/ui/StatusBadge'

interface SettingsSection {
  id: string
  title: string
  icon: React.ReactNode
  description: string
}

const sections: SettingsSection[] = [
  { id: 'repository', title: 'Repository Settings', icon: <GitBranch size={18} />, description: 'Configure repository connections and sync settings' },
  { id: 'notifications', title: 'Notifications', icon: <Bell size={18} />, description: 'Manage alert preferences and notification channels' },
  { id: 'appearance', title: 'Appearance', icon: <Palette size={18} />, description: 'Customize the look and feel of RepoPilot' },
  { id: 'account', title: 'Account', icon: <User size={18} />, description: 'Manage your account settings and preferences' },
]

function SettingsField({ 
  label, 
  description, 
  children 
}: { 
  label: string
  description?: string
  children: React.ReactNode 
}) {
  return (
    <div className="space-y-2">
      <div>
        <label className="text-sm font-medium text-text-primary">{label}</label>
        {description && <p className="mt-0.5 text-xs text-text-muted">{description}</p>}
      </div>
      {children}
    </div>
  )
}

export function SettingsPage() {
  const [activeSection, setActiveSection] = useState('repository')

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Settings</h1>
          <p className="mt-1 text-sm text-text-secondary">Configure RepoPilot to match your workflow</p>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[240px_1fr]">
        <nav className="space-y-1">
          {sections.map((section) => (
            <button
              key={section.id}
              onClick={() => setActiveSection(section.id)}
              className={clsx(
                'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
                activeSection === section.id
                  ? 'bg-accent-muted text-accent'
                  : 'text-text-secondary hover:bg-bg-hover hover:text-text-primary'
              )}
            >
              <span className={clsx(
                activeSection === section.id ? 'text-accent' : 'text-text-muted'
              )}>
                {section.icon}
              </span>
              <span className="font-medium">{section.title}</span>
            </button>
          ))}
        </nav>

        <div className="rounded-xl border border-border-primary bg-bg-secondary p-6">
          {activeSection === 'repository' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-text-primary">Repository Settings</h2>
                <p className="mt-1 text-sm text-text-muted">Configure how RepoPilot interacts with your repositories</p>
              </div>

              <div className="space-y-6">
                <SettingsField label="Connected Repository" description="The repository RepoPilot is monitoring">
                  <div className="flex items-center gap-3 rounded-lg border border-border-primary bg-bg-tertiary p-3">
                    <GitBranch size={16} className="text-text-muted" />
                    <span className="text-sm text-text-primary font-mono">NexusPay/nexuspay-platform</span>
                    <StatusBadge label="Connected" variant="success" />
                  </div>
                </SettingsField>

                <SettingsField label="Sync Frequency" description="How often to fetch new data from GitHub">
                  <select className="w-full rounded-lg border border-border-primary bg-bg-tertiary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent">
                    <option>Every 5 minutes</option>
                    <option>Every 15 minutes</option>
                    <option>Every 30 minutes</option>
                    <option>Every hour</option>
                  </select>
                </SettingsField>

                <SettingsField label="Branch Protection" description="Require reviews for protected branches">
                  <div className="flex items-center gap-3">
                    <div className="relative inline-flex h-6 w-11 cursor-pointer rounded-full bg-bg-tertiary transition-colors">
                      <span className="absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-text-muted transition-transform" />
                    </div>
                    <span className="text-sm text-text-secondary">Disabled</span>
                  </div>
                </SettingsField>

                <SettingsField label="Auto-merge Rules" description="Configure automatic merge settings">
                  <div className="rounded-lg border border-border-primary bg-bg-tertiary p-4 text-center">
                    <p className="text-sm text-text-muted">No auto-merge rules configured</p>
                    <button className="mt-2 text-sm font-medium text-accent hover:text-accent-hover transition-colors">
                      Add Rule
                    </button>
                  </div>
                </SettingsField>
              </div>
            </div>
          )}

          {activeSection === 'notifications' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-text-primary">Notifications</h2>
                <p className="mt-1 text-sm text-text-muted">Manage how you receive alerts and updates</p>
              </div>

              <div className="space-y-6">
                <SettingsField label="Email Notifications" description="Receive alerts via email">
                  <div className="flex items-center gap-3">
                    <div className="relative inline-flex h-6 w-11 cursor-pointer rounded-full bg-accent transition-colors">
                      <span className="absolute right-0.5 top-0.5 h-5 w-5 rounded-full bg-white transition-transform" />
                    </div>
                    <span className="text-sm text-text-secondary">Enabled</span>
                  </div>
                </SettingsField>

                <SettingsField label="Slack Integration" description="Send alerts to Slack channels">
                  <div className="rounded-lg border border-border-primary bg-bg-tertiary p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-text-primary">#engineering-alerts</span>
                      <StatusBadge label="Connected" variant="success" />
                    </div>
                  </div>
                </SettingsField>

                <SettingsField label="PagerDuty Integration" description="Create incidents for critical alerts">
                  <div className="rounded-lg border border-border-primary bg-bg-tertiary p-4">
                    <div className="flex items-center justify-between">
                      <span className="text-sm text-text-primary">NexusPay Engineering</span>
                      <StatusBadge label="Connected" variant="success" />
                    </div>
                  </div>
                </SettingsField>

                <SettingsField label="Alert Thresholds" description="Configure when to trigger alerts">
                  <div className="space-y-3">
                    <div className="flex items-center justify-between rounded-lg border border-border-primary bg-bg-tertiary p-3">
                      <span className="text-sm text-text-secondary">CI Failure Rate</span>
                      <span className="text-sm font-medium text-text-primary">{'>'} 10%</span>
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-border-primary bg-bg-tertiary p-3">
                      <span className="text-sm text-text-secondary">Incident Severity</span>
                      <span className="text-sm font-medium text-text-primary">SEV-1 & SEV-2</span>
                    </div>
                    <div className="flex items-center justify-between rounded-lg border border-border-primary bg-bg-tertiary p-3">
                      <span className="text-sm text-text-secondary">Risk Score</span>
                      <span className="text-sm font-medium text-text-primary">{'>'} 80</span>
                    </div>
                  </div>
                </SettingsField>
              </div>
            </div>
          )}

          {activeSection === 'appearance' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-text-primary">Appearance</h2>
                <p className="mt-1 text-sm text-text-muted">Customize the visual appearance of RepoPilot</p>
              </div>

              <div className="space-y-6">
                <SettingsField label="Theme" description="Choose your preferred color scheme">
                  <div className="grid grid-cols-3 gap-3">
                    <button className="rounded-lg border-2 border-accent bg-bg-primary p-4 text-center">
                      <div className="mb-2 flex justify-center gap-1">
                        <div className="h-4 w-4 rounded-full bg-bg-primary border border-border-primary" />
                        <div className="h-4 w-4 rounded-full bg-accent" />
                      </div>
                      <span className="text-xs font-medium text-accent">Dark</span>
                    </button>
                    <button className="rounded-lg border border-border-primary bg-bg-primary p-4 text-center opacity-50">
                      <div className="mb-2 flex justify-center gap-1">
                        <div className="h-4 w-4 rounded-full bg-gray-100 border border-gray-200" />
                        <div className="h-4 w-4 rounded-full bg-gray-400" />
                      </div>
                      <span className="text-xs font-medium text-text-muted">Light</span>
                    </button>
                    <button className="rounded-lg border border-border-primary bg-bg-primary p-4 text-center opacity-50">
                      <div className="mb-2 flex justify-center gap-1">
                        <div className="h-4 w-4 rounded-full bg-gray-900 border border-gray-700" />
                        <div className="h-4 w-4 rounded-full bg-yellow-500" />
                      </div>
                      <span className="text-xs font-medium text-text-muted">System</span>
                    </button>
                  </div>
                </SettingsField>

                <SettingsField label="Accent Color" description="Choose your accent color">
                  <div className="flex gap-2">
                    {['bg-indigo-500', 'bg-blue-500', 'bg-emerald-500', 'bg-amber-500', 'bg-rose-500'].map((color, i) => (
                      <button
                        key={color}
                        className={clsx(
                          'h-8 w-8 rounded-full transition-transform',
                          color,
                          i === 0 ? 'ring-2 ring-offset-2 ring-offset-bg-secondary ring-indigo-500' : 'hover:scale-110'
                        )}
                      />
                    ))}
                  </div>
                </SettingsField>

                <SettingsField label="Font Size" description="Adjust the text size">
                  <select className="w-full rounded-lg border border-border-primary bg-bg-tertiary px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-accent">
                    <option>Small</option>
                    <option>Medium (Default)</option>
                    <option>Large</option>
                  </select>
                </SettingsField>

                <SettingsField label="Sidebar Position" description="Choose sidebar placement">
                  <div className="flex gap-3">
                    <button className="flex-1 rounded-lg border-2 border-accent bg-bg-tertiary p-3 text-center">
                      <span className="text-xs font-medium text-accent">Left</span>
                    </button>
                    <button className="flex-1 rounded-lg border border-border-primary bg-bg-tertiary p-3 text-center opacity-50">
                      <span className="text-xs font-medium text-text-muted">Right</span>
                    </button>
                  </div>
                </SettingsField>
              </div>
            </div>
          )}

          {activeSection === 'account' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-lg font-semibold text-text-primary">Account</h2>
                <p className="mt-1 text-sm text-text-muted">Manage your account settings and preferences</p>
              </div>

              <div className="space-y-6">
                <SettingsField label="Profile" description="Your account information">
                  <div className="flex items-center gap-4 rounded-lg border border-border-primary bg-bg-tertiary p-4">
                    <div className="flex h-12 w-12 items-center justify-center rounded-full bg-accent/20 text-accent">
                      <span className="text-lg font-medium">JD</span>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-text-primary">John Doe</p>
                      <p className="text-xs text-text-muted">john.doe@nexuspay.com</p>
                    </div>
                    <button className="ml-auto flex items-center gap-2 text-sm text-text-muted hover:text-text-primary transition-colors">
                      <ExternalLink size={14} />
                      Edit Profile
                    </button>
                  </div>
                </SettingsField>

                <SettingsField label="GitHub Account" description="Connected GitHub account">
                  <div className="flex items-center gap-3 rounded-lg border border-border-primary bg-bg-tertiary p-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-bg-primary text-text-primary">
                      <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
                        <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
                      </svg>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-text-primary">john-doe</p>
                      <p className="text-xs text-text-muted">Connected</p>
                    </div>
                    <StatusBadge label="Active" variant="success" />
                  </div>
                </SettingsField>

                <SettingsField label="API Key" description="Your personal API key for integrations">
                  <div className="flex items-center gap-3 rounded-lg border border-border-primary bg-bg-tertiary p-3">
                    <code className="flex-1 font-mono text-sm text-text-secondary">rp_sk_••••••••••••••••</code>
                    <button className="text-sm font-medium text-accent hover:text-accent-hover transition-colors">
                      Regenerate
                    </button>
                  </div>
                </SettingsField>

                <SettingsField label="Danger Zone" description="Irreversible actions">
                  <div className="rounded-lg border border-danger/30 bg-danger/5 p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="text-sm font-medium text-text-primary">Delete Account</p>
                        <p className="text-xs text-text-muted">Permanently delete your account and all associated data</p>
                      </div>
                      <button className="rounded-lg border border-danger/30 px-4 py-2 text-sm font-medium text-danger hover:bg-danger/10 transition-colors">
                        Delete
                      </button>
                    </div>
                  </div>
                </SettingsField>
              </div>
            </div>
          )}

          <div className="mt-8 flex items-center justify-end gap-3 border-t border-border-primary pt-6">
            <button className="rounded-lg border border-border-primary px-4 py-2 text-sm font-medium text-text-secondary hover:bg-bg-hover transition-colors">
              Cancel
            </button>
            <button className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover transition-colors">
              <Save size={14} />
              Save Changes
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
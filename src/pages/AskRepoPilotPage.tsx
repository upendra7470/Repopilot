import { useState } from 'react'
import { Sparkles, Search, ArrowRight, ExternalLink, AlertTriangle, GitPullRequest, Box, Users } from 'lucide-react'
import clsx from 'clsx'
import { StatusBadge } from '../components/ui/StatusBadge'

const suggestedQuestions = [
  "What changed recently?",
  "Why is PR #821 risky?",
  "Who owns payment-service?",
  "Have we seen this issue before?",
  "Why is CI degrading?",
]

const demoAnswer = {
  question: "Why is PR #821 risky?",
  answer: "PR #821 is flagged as critical risk due to several concerning factors:",
  evidence: [
    {
      type: "risk-signal",
      icon: <AlertTriangle size={14} />,
      title: "PCI Compliance Concern",
      description: "Modifies transaction state machine without PCI auditor review",
      severity: "high" as const,
    },
    {
      type: "risk-signal",
      icon: <GitPullRequest size={14} />,
      title: "Broad Code Changes",
      description: "Changes 23 files across the payment retry pipeline with only 3 new unit tests",
      severity: "high" as const,
    },
    {
      type: "risk-signal",
      icon: <AlertTriangle size={14} />,
      title: "Insufficient Test Coverage",
      description: "New retry scenarios lack integration test coverage for 847 lines of new code",
      severity: "medium" as const,
    },
  ],
  relatedEntities: [
    { type: "component", name: "payment-service", icon: <Box size={12} /> },
    { type: "contributor", name: "David Kim", icon: <Users size={12} /> },
    { type: "pr", name: "#821", icon: <GitPullRequest size={12} /> },
  ],
  recommendedAction: {
    title: "Request Security Review",
    description: "Before merging, get sign-off from the security team for PCI compliance implications and add integration tests for retry failure scenarios.",
    priority: "high" as const,
  },
}

export function AskRepoPilotPage() {
  const [query, setQuery] = useState('')
  const [showDemo, setShowDemo] = useState(false)

  const handleSuggestionClick = (question: string) => {
    setQuery(question)
    setShowDemo(true)
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8">
      <div className="text-center">
        <div className="flex items-center justify-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-accent-muted text-accent">
            <Sparkles size={24} />
          </div>
          <h1 className="text-3xl font-bold text-text-primary">Ask RepoPilot</h1>
        </div>
        <p className="mt-3 text-sm text-text-secondary">
          Get intelligent answers about your engineering system
        </p>
      </div>

      <div className="relative">
        <div className="relative rounded-xl border border-border-primary bg-bg-secondary p-1 shadow-lg">
          <div className="flex items-center gap-3 px-4 py-3">
            <Search size={20} className="shrink-0 text-text-muted" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Ask a question about your engineering..."
              className="flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-muted focus:outline-none"
            />
            <button
              onClick={() => query && setShowDemo(true)}
              disabled={!query}
              className={clsx(
                'flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors',
                query
                  ? 'bg-accent text-white hover:bg-accent-hover'
                  : 'bg-bg-tertiary text-text-muted cursor-not-allowed'
              )}
            >
              Ask
              <ArrowRight size={14} />
            </button>
          </div>
        </div>
      </div>

      <div className="space-y-3">
        <p className="text-xs text-text-muted text-center">Suggested questions</p>
        <div className="flex flex-wrap justify-center gap-2">
          {suggestedQuestions.map((question) => (
            <button
              key={question}
              onClick={() => handleSuggestionClick(question)}
              className="rounded-full border border-border-primary bg-bg-secondary px-4 py-2 text-sm text-text-secondary transition-colors hover:border-accent hover:text-accent hover:bg-accent-muted"
            >
              {question}
            </button>
          ))}
        </div>
      </div>

      {showDemo && (
        <div className="rounded-xl border border-accent/30 bg-bg-secondary p-6 space-y-6">
          <div className="flex items-center gap-2">
            <StatusBadge label="Demo" variant="info" />
            <span className="text-xs text-text-muted">Example response</span>
          </div>

          <div>
            <h3 className="text-lg font-semibold text-text-primary">{demoAnswer.question}</h3>
            <p className="mt-2 text-sm text-text-secondary">{demoAnswer.answer}</p>
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-medium text-text-secondary">Evidence Chain</h4>
            {demoAnswer.evidence.map((item, i) => (
              <div
                key={i}
                className={clsx(
                  'flex items-start gap-3 rounded-lg border p-3',
                  item.severity === 'high' ? 'border-danger/30 bg-danger/5' : 'border-warning/30 bg-warning/5'
                )}
              >
                <div className={clsx(
                  'mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full',
                  item.severity === 'high' ? 'bg-danger/15 text-danger' : 'bg-warning/15 text-warning'
                )}>
                  {item.icon}
                </div>
                <div>
                  <p className="text-sm font-medium text-text-primary">{item.title}</p>
                  <p className="mt-0.5 text-xs text-text-muted">{item.description}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="space-y-3">
            <h4 className="text-sm font-medium text-text-secondary">Related Entities</h4>
            <div className="flex flex-wrap gap-2">
              {demoAnswer.relatedEntities.map((entity, i) => (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-lg border border-border-primary bg-bg-tertiary px-3 py-1.5"
                >
                  <span className="text-text-muted">{entity.icon}</span>
                  <span className="text-xs text-text-secondary">{entity.name}</span>
                  <span className="text-[10px] text-text-muted">{entity.type}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-accent/30 bg-accent-muted p-4">
            <div className="flex items-center gap-2">
              <StatusBadge label={demoAnswer.recommendedAction.priority} variant="danger" />
              <h4 className="text-sm font-medium text-text-primary">{demoAnswer.recommendedAction.title}</h4>
            </div>
            <p className="mt-2 text-sm text-text-secondary">{demoAnswer.recommendedAction.description}</p>
            <button className="mt-3 flex items-center gap-2 text-sm font-medium text-accent hover:text-accent-hover transition-colors">
              <ExternalLink size={14} />
              View PR #821
            </button>
          </div>
        </div>
      )}

      {!showDemo && (
        <div className="rounded-xl border border-border-primary bg-bg-secondary p-8 text-center">
          <Sparkles size={32} className="mx-auto mb-4 text-text-muted" />
          <p className="text-sm text-text-muted">
            Ask a question to get started. RepoPilot will analyze your codebase, 
            incidents, and engineering history to provide intelligent answers.
          </p>
        </div>
      )}
    </div>
  )
}
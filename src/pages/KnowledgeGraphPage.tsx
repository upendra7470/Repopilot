import { useState, useMemo } from 'react'
import { GitBranch, Users, AlertTriangle, Box, Info } from 'lucide-react'
import { demoComponents, demoContributors, demoIncidents, demoRepository } from '../data/demo'

type NodeType = 'repository' | 'component' | 'contributor' | 'incident'

interface GraphNode {
  id: string
  type: NodeType
  label: string
  x: number
  y: number
  color: string
  size: number
}

interface GraphEdge {
  from: string
  to: string
  type: 'owns' | 'affects' | 'part-of'
}

const nodeTypeConfig: Record<NodeType, { color: string; icon: React.ReactNode }> = {
  repository: { color: '#6366f1', icon: <GitBranch size={12} /> },
  component: { color: '#3b82f6', icon: <Box size={12} /> },
  contributor: { color: '#22c55e', icon: <Users size={12} /> },
  incident: { color: '#ef4444', icon: <AlertTriangle size={12} /> },
}

function generateGraphData() {
  const nodes: GraphNode[] = []
  const edges: GraphEdge[] = []

  const centerX = 400
  const centerY = 300

  nodes.push({
    id: demoRepository.id,
    type: 'repository',
    label: demoRepository.name,
    x: centerX,
    y: centerY,
    color: nodeTypeConfig.repository.color,
    size: 24,
  })

  const componentRadius = 150
  const componentAngleStep = (2 * Math.PI) / demoComponents.length
  
  demoComponents.forEach((comp, i) => {
    const angle = i * componentAngleStep - Math.PI / 2
    const x = centerX + componentRadius * Math.cos(angle)
    const y = centerY + componentRadius * Math.sin(angle)
    
    nodes.push({
      id: comp.id,
      type: 'component',
      label: comp.name,
      x,
      y,
      color: nodeTypeConfig.component.color,
      size: 16,
    })
    
    edges.push({ from: demoRepository.id, to: comp.id, type: 'part-of' })
  })

  const contributorRadius = 280
  const contributorAngleStep = (2 * Math.PI) / demoContributors.length
  
  demoContributors.forEach((contrib, i) => {
    const angle = i * contributorAngleStep - Math.PI / 2
    const x = centerX + contributorRadius * Math.cos(angle)
    const y = centerY + contributorRadius * Math.sin(angle)
    
    nodes.push({
      id: contrib.id,
      type: 'contributor',
      label: contrib.name,
      x,
      y,
      color: nodeTypeConfig.contributor.color,
      size: 12,
    })
    
    contrib.ownedComponents.forEach(compName => {
      const comp = demoComponents.find(c => c.name === compName)
      if (comp) {
        edges.push({ from: contrib.id, to: comp.id, type: 'owns' })
      }
    })
  })

  demoIncidents.forEach((incident, i) => {
    const comp = demoComponents.find(c => c.id === incident.componentId)
    if (comp) {
      const compNode = nodes.find(n => n.id === comp.id)
      const baseX = compNode ? compNode.x : centerX
      const baseY = compNode ? compNode.y : centerY

      const offsetAngle = (i * Math.PI) / 3
      const x = baseX + 60 * Math.cos(offsetAngle)
      const y = baseY + 60 * Math.sin(offsetAngle)
      
      nodes.push({
        id: incident.id,
        type: 'incident',
        label: incident.title.substring(0, 20) + '...',
        x,
        y,
        color: nodeTypeConfig.incident.color,
        size: 10,
      })
      
      edges.push({ from: incident.id, to: comp.id, type: 'affects' })
    }
  })

  return { nodes, edges }
}

function findNodePosition(nodes: GraphNode[], id: string): { x: number; y: number } | null {
  const node = nodes.find(n => n.id === id)
  return node ? { x: node.x, y: node.y } : null
}

export function KnowledgeGraphPage() {
  const [hoveredNode, setHoveredNode] = useState<string | null>(null)
  const { nodes, edges } = useMemo(() => generateGraphData(), [])

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Knowledge Graph</h1>
          <p className="mt-1 text-sm text-text-secondary">Visualize relationships between components, contributors, and incidents</p>
        </div>
        <div className="flex items-center gap-2">
          <Info size={14} className="text-text-muted" />
          <span className="text-xs text-text-muted">Interactive visualization</span>
        </div>
      </div>

      <div className="rounded-lg border border-border-primary bg-bg-secondary p-4">
        <div className="flex items-center gap-4 mb-4">
          {Object.entries(nodeTypeConfig).map(([type, config]) => (
            <div key={type} className="flex items-center gap-2">
              <div 
                className="h-3 w-3 rounded-full"
                style={{ backgroundColor: config.color }}
              />
              <span className="text-xs text-text-muted capitalize">{type}</span>
            </div>
          ))}
        </div>

        <svg 
          viewBox="0 0 800 600" 
          className="w-full h-[500px] bg-bg-primary rounded-lg"
        >
          <defs>
            <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="3" result="coloredBlur"/>
              <feMerge>
                <feMergeNode in="coloredBlur"/>
                <feMergeNode in="SourceGraphic"/>
              </feMerge>
            </filter>
          </defs>

          {edges.map((edge, i) => {
            const fromPos = findNodePosition(nodes, edge.from)
            const toPos = findNodePosition(nodes, edge.to)
            
            if (!fromPos || !toPos) return null
            
            const isHighlighted = hoveredNode === edge.from || hoveredNode === edge.to
            
            return (
              <line
                key={`edge-${i}`}
                x1={fromPos.x}
                y1={fromPos.y}
                x2={toPos.x}
                y2={toPos.y}
                stroke={isHighlighted ? '#6366f1' : '#2a2a3a'}
                strokeWidth={isHighlighted ? 2 : 1}
                strokeDasharray={edge.type === 'affects' ? '4,4' : 'none'}
                className="transition-all duration-200"
              />
            )
          })}

          {nodes.map(node => {
            const isHovered = hoveredNode === node.id
            const isConnectedToHovered = hoveredNode && edges.some(
              e => (e.from === hoveredNode && e.to === node.id) || 
                   (e.to === hoveredNode && e.from === node.id)
            )
            
            return (
              <g 
                key={node.id}
                onMouseEnter={() => setHoveredNode(node.id)}
                onMouseLeave={() => setHoveredNode(null)}
                className="cursor-pointer"
              >
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={node.size}
                  fill={node.color}
                  opacity={isHovered || isConnectedToHovered || !hoveredNode ? 1 : 0.3}
                  filter={isHovered ? 'url(#glow)' : undefined}
                  className="transition-all duration-200"
                />
                
                {isHovered && (
                  <g>
                    <rect
                      x={node.x - 60}
                      y={node.y - node.size - 30}
                      width={120}
                      height={24}
                      rx={4}
                      fill="#1e1e28"
                      stroke="#3a3a5a"
                      strokeWidth={1}
                    />
                    <text
                      x={node.x}
                      y={node.y - node.size - 14}
                      textAnchor="middle"
                      fill="#e8e8ed"
                      fontSize={11}
                      fontFamily="Inter, system-ui, sans-serif"
                    >
                      {node.label}
                    </text>
                  </g>
                )}
              </g>
            )
          })}
        </svg>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-border-primary bg-bg-secondary p-4">
          <h3 className="text-sm font-semibold text-text-primary mb-3">Graph Statistics</h3>
          <div className="space-y-2 text-sm text-text-secondary">
            <div className="flex justify-between">
              <span>Total Nodes</span>
              <span className="font-medium text-text-primary">{nodes.length}</span>
            </div>
            <div className="flex justify-between">
              <span>Total Edges</span>
              <span className="font-medium text-text-primary">{edges.length}</span>
            </div>
            <div className="flex justify-between">
              <span>Components</span>
              <span className="font-medium text-text-primary">{demoComponents.length}</span>
            </div>
            <div className="flex justify-between">
              <span>Contributors</span>
              <span className="font-medium text-text-primary">{demoContributors.length}</span>
            </div>
            <div className="flex justify-between">
              <span>Active Incidents</span>
              <span className="font-medium text-text-primary">
                {demoIncidents.filter(i => i.status !== 'closed').length}
              </span>
            </div>
          </div>
        </div>

        <div className="rounded-lg border border-border-primary bg-bg-secondary p-4">
          <h3 className="text-sm font-semibold text-text-primary mb-3">How to Use</h3>
          <div className="space-y-2 text-sm text-text-muted">
            <p>• Hover over nodes to see their connections</p>
            <p>• Different colors represent different entity types</p>
            <p>• Dashed lines show incident relationships</p>
            <p>• Solid lines show ownership and structural relationships</p>
            <p className="text-text-secondary mt-3">
              This is a foundational visualization. A real implementation would use a graph database 
              and dynamic layout algorithms.
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
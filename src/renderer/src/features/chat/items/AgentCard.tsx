import { Bot, Check, X } from 'lucide-react'
import type { ChatItem } from '../../../../../shared/types'

type AgentItem = Extract<ChatItem, { kind: 'agent' }>

export function AgentCard({ item }: { item: AgentItem }): React.JSX.Element {
  return (
    <div className="card-x">
      <div className="cx-head">
        <Bot className="i sm" strokeWidth={1.8} />
        <span className="agent-name">{item.agentType}</span>
        <span className="path" style={{ fontFamily: 'var(--font)', fontSize: 12.5 }}>
          {item.description}
        </span>
        <span className="right">
          {item.toolCount !== undefined && <span className="num">{item.toolCount} tool calls</span>}
          {item.status === 'error' ? (
            <span className="del" style={{ display: 'grid' }}>
              <X className="i sm" strokeWidth={1.8} />
            </span>
          ) : (
            <span className="okc">
              <Check className="i sm" strokeWidth={1.8} />
            </span>
          )}
        </span>
      </div>
      {item.result && <div className="agent-body">{item.result}</div>}
    </div>
  )
}

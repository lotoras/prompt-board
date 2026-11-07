import { useState } from 'react'
import { ListChecks } from 'lucide-react'
import type { ChatItem, PlanDecision } from '../../../../../shared/types'
import { api } from '../../../lib/api'
import { Markdown } from '../Markdown'

type PlanItem = Extract<ChatItem, { kind: 'plan' }>

export function PlanCard({ chatId, item }: { chatId: string; item: PlanItem }): React.JSX.Element {
  const [revising, setRevising] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [sent, setSent] = useState(false)

  if (item.state !== 'pending') {
    return (
      <div className="plan done">
        <div className="cx-head">
          <ListChecks className="i sm" strokeWidth={1.8} />
          <span>{item.state === 'approved' ? 'Plan approved' : 'Plan sent back'}</span>
        </div>
        <div className="plan-body md" style={{ fontSize: 13.5 }}>
          <Markdown>{item.plan}</Markdown>
        </div>
        <div style={{ height: 10 }} />
      </div>
    )
  }

  const decide = (decision: PlanDecision): void => {
    setSent(true)
    void Promise.resolve(api.chat.decidePlan(chatId, item.id, decision)).catch((e) => {
      console.error(e)
      setSent(false)
    })
  }

  return (
    <div className="plan">
      <div className="cx-head">
        <ListChecks className="i sm" strokeWidth={1.8} />
        <span>Plan ready for review</span>
      </div>
      <div className="plan-body md" style={{ fontSize: 13.5 }}>
        <Markdown>{item.plan}</Markdown>
      </div>
      {revising && (
        <textarea
          autoFocus
          placeholder="What should Claude change in the plan?"
          value={feedback}
          onChange={(e) => setFeedback(e.target.value)}
        />
      )}
      <div className="card-foot">
        {revising ? (
          <>
            <button type="button" className="btn quiet" onClick={() => setRevising(false)}>
              Cancel
            </button>
            <span className="spacer" />
            <button
              type="button"
              className="btn outline"
              disabled={sent}
              onClick={() => decide({ approve: false, feedback: feedback.trim() || 'Keep planning.' })}
            >
              Send feedback
            </button>
          </>
        ) : (
          <>
            <button type="button" className="btn quiet" onClick={() => setRevising(true)}>
              Keep planning
            </button>
            <span className="spacer" />
            <button
              type="button"
              className="btn amber"
              disabled={sent}
              onClick={() => decide({ approve: true })}
            >
              Approve plan
            </button>
          </>
        )}
      </div>
    </div>
  )
}

import { useState } from 'react'
import { MessageCircleQuestion } from 'lucide-react'
import type { ChatItem } from '../../../../../shared/types'
import { api } from '../../../lib/api'

type QuestionItem = Extract<ChatItem, { kind: 'question' }>

interface Pick {
  labels: string[]
  other: boolean
  otherText: string
}

const EMPTY: Pick = { labels: [], other: false, otherText: '' }

function answerOf(pick: Pick): string | undefined {
  if (pick.other && pick.otherText.trim()) return pick.otherText.trim()
  if (pick.labels.length) return pick.labels.join(', ')
  return undefined
}

export function QuestionCard({
  chatId,
  item
}: {
  chatId: string
  item: QuestionItem
}): React.JSX.Element {
  const [picks, setPicks] = useState<Record<string, Pick>>({})
  const [sent, setSent] = useState(false)

  if (item.state !== 'pending') {
    return (
      <div className="answered-list">
        {item.questions.map((q) => (
          <div key={q.question} className="answered">
            <MessageCircleQuestion className="i sm" strokeWidth={1.8} />
            <span>{q.question}</span>
            <b>{item.state === 'skipped' ? 'Skipped' : (item.answers?.[q.question] ?? 'Answered')}</b>
          </div>
        ))}
        {item.questions.length === 0 && (
          <div className="answered">
            <MessageCircleQuestion className="i sm" strokeWidth={1.8} />
            <b>{item.state === 'skipped' ? 'Skipped' : 'Answered'}</b>
          </div>
        )}
      </div>
    )
  }

  const pickOf = (q: string): Pick => picks[q] ?? EMPTY
  const patch = (q: string, next: Partial<Pick>): void =>
    setPicks((prev) => ({ ...prev, [q]: { ...(prev[q] ?? EMPTY), ...next } }))

  const choose = (q: string, label: string, multi: boolean): void => {
    const cur = pickOf(q)
    if (multi) {
      const labels = cur.labels.includes(label)
        ? cur.labels.filter((l) => l !== label)
        : [...cur.labels, label]
      patch(q, { labels })
    } else {
      patch(q, { labels: [label], other: false })
    }
  }

  const toggleOther = (q: string, multi: boolean): void => {
    const cur = pickOf(q)
    patch(q, { other: !cur.other, ...(multi || cur.other ? {} : { labels: [] }) })
  }

  const answers: Record<string, string> = {}
  for (const q of item.questions) {
    const a = answerOf(pickOf(q.question))
    if (a !== undefined) answers[q.question] = a
  }
  const complete = item.questions.every((q) => answers[q.question] !== undefined)

  const submit = (value: Record<string, string> | null): void => {
    setSent(true)
    void Promise.resolve(api.chat.answer(chatId, item.id, value)).catch((e) => {
      console.error(e)
      setSent(false)
    })
  }

  return (
    <div className="ask">
      <div className="cx-head">
        <MessageCircleQuestion className="i sm" strokeWidth={1.8} />
        <span>Claude is asking</span>
        {item.questions[0]?.header && (
          <span className="right">
            <span className="tag">{item.questions[0].header}</span>
          </span>
        )}
      </div>
      {item.questions.map((q) => {
        const cur = pickOf(q.question)
        return (
          <div key={q.question}>
            <div className="ask-q">{q.question}</div>
            <div className="ask-opts">
              {q.options.map((o) => (
                <button
                  key={o.label}
                  type="button"
                  className={`opt${cur.labels.includes(o.label) ? ' on' : ''}`}
                  onClick={() => choose(q.question, o.label, q.multiSelect)}
                >
                  <span className="radio" />
                  <span>
                    <div className="opt-label">{o.label}</div>
                    {o.description && <div className="opt-desc">{o.description}</div>}
                  </span>
                </button>
              ))}
              <button
                type="button"
                className={`opt${cur.other ? ' on' : ''}`}
                onClick={() => toggleOther(q.question, q.multiSelect)}
              >
                <span className="radio" />
                <span>
                  <div className="opt-label">Other</div>
                </span>
              </button>
            </div>
            {cur.other && (
              <input
                className="ask-other"
                placeholder="Type a different answer"
                autoFocus
                value={cur.otherText}
                onChange={(e) => patch(q.question, { otherText: e.target.value })}
              />
            )}
          </div>
        )
      })}
      <div className="card-foot">
        <button type="button" className="btn quiet" disabled={sent} onClick={() => submit(null)}>
          Skip
        </button>
        <span className="spacer" />
        <button
          type="button"
          className="btn amber"
          disabled={sent || !complete}
          onClick={() => submit(answers)}
        >
          Send answer
        </button>
      </div>
    </div>
  )
}

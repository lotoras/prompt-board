import type { ChatItem } from '../../../../../shared/types'
import { Markdown } from '../Markdown'

type AssistantItem = Extract<ChatItem, { kind: 'assistant' }>

export function AssistantText({ item }: { item: AssistantItem }): React.JSX.Element {
  return (
    <div className="md">
      <Markdown>{item.markdown}</Markdown>
      {item.streaming && <span className="caret" />}
    </div>
  )
}

import { useState } from 'react'
import { X } from 'lucide-react'

interface TagInputProps {
  tags: string[]
  onChange: (tags: string[]) => void
  id?: string
}

export function TagInput({ tags, onChange, id }: TagInputProps): React.JSX.Element {
  const [draft, setDraft] = useState('')

  const addTag = (): void => {
    const value = draft.trim()
    if (!value || tags.includes(value)) {
      setDraft('')
      return
    }
    onChange([...tags, value])
    setDraft('')
  }

  return (
    <div className="tags-in">
      {tags.map((tag) => (
        <span key={tag} className="tag">
          {tag}
          <button
            type="button"
            aria-label={`Remove ${tag}`}
            onClick={() => onChange(tags.filter((t) => t !== tag))}
          >
            <X className="i sm" strokeWidth={1.8} />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        placeholder="Add a tag and press Enter"
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            addTag()
          }
        }}
        onBlur={addTag}
      />
    </div>
  )
}

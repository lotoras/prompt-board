import type { StateCreator } from 'zustand'
import { suggestBranchName } from '../../../shared/chat'
import { statusTone } from '../../../shared/types'
import { withoutKey } from '../lib/objects'
import type {
  AccountInfo,
  ChatAttachment,
  ChatCreateInput,
  ChatItem,
  ChatItemsEvent,
  ChatMeta,
  ChatPatch,
  RateLimits,
  SlashCommandInfo,
  ChatToggles,
  WorkspacePlan
} from '../../../shared/types'
import { api } from '../lib/api'
import { applyItemsEvent } from '../lib/chatItems'
import type { StoreState } from './index'

export const BOARD_TAB = 'board'

export interface Draft {
  text: string
  attachments: ChatAttachment[]
  workspace: WorkspacePlan
  branchTouched: boolean
  nameTouched: boolean
}

export type WorkspacePatch = Partial<WorkspacePlan> & {
  branchTouched?: boolean
  nameTouched?: boolean
}

export const EMPTY_DRAFT: Draft = {
  text: '',
  attachments: [],
  workspace: { newWorktree: false, newBranch: false },
  branchTouched: false,
  nameTouched: false
}

export interface ChatsSlice {
  chats: ChatMeta[]
  activeByProject: Record<string, string>
  items: Record<string, ChatItem[]>
  drafts: Record<string, Draft>
  toggleDefaults: Record<string, ChatToggles>
  tuiPtyByChat: Record<string, string>
  rateLimits: RateLimits | null
  accounts: AccountInfo[]
  slashCommands: Record<string, SlashCommandInfo[]>
  setRateLimits: (limits: RateLimits | null) => void
  setAccounts: (accounts: AccountInfo[]) => void
  loadSlashCommands: (chatId: string) => Promise<void>
  clearChat: (chatId: string) => void
  setChats: (chats: ChatMeta[]) => void
  setActiveByProject: (active: Record<string, string>) => void
  applyItems: (event: ChatItemsEvent) => void
  loadHistory: (chatId: string) => Promise<void>
  createChat: (input: ChatCreateInput) => Promise<void>
  setActiveTab: (projectKey: string, tab: string) => void
  setDraftText: (chatId: string, text: string) => void
  addAttachments: (chatId: string, attachments: ChatAttachment[]) => void
  removeAttachment: (chatId: string, path: string) => void
  setWorkspace: (chatId: string, patch: WorkspacePatch) => void
  sendChat: (chatId: string, opts?: { interrupt?: boolean }) => Promise<void>
  updateChat: (chatId: string, patch: ChatPatch) => void
  closeChat: (chatId: string) => Promise<void>
  toggleChatAck: (chatId: string) => void
  openInTui: (chatId: string) => Promise<void>
  takeOverChat: (chatId: string) => Promise<void>
  chatsFor: (projectKey: string) => ChatMeta[]
  activeTabFor: (projectKey: string) => string
}

const TOGGLES_KEY = 'prompt-board:toggles'

function loadToggleDefaults(): Record<string, ChatToggles> {
  try {
    const raw = localStorage.getItem(TOGGLES_KEY)
    if (raw) return JSON.parse(raw) as Record<string, ChatToggles>
  } catch {
    // ignore malformed storage
  }
  return {}
}

function persistToggleDefaults(value: Record<string, ChatToggles>): void {
  try {
    localStorage.setItem(TOGGLES_KEY, JSON.stringify(value))
  } catch {
    // ignore storage failures
  }
}

function fire(call: () => Promise<unknown> | undefined): void {
  try {
    void Promise.resolve(call()).catch((error) => console.error(error))
  } catch (error) {
    console.error(error)
  }
}

export function effectiveBranchName(draft: Draft): string {
  return draft.nameTouched && draft.workspace.branchName
    ? draft.workspace.branchName
    : suggestBranchName(draft.text)
}

const loadingCommands = new Set<string>()

export const createChatsSlice: StateCreator<StoreState, [], [], ChatsSlice> = (set, get) => {
  const patchDraft = (chatId: string, patch: Partial<Draft>): void =>
    set((state) => ({
      drafts: { ...state.drafts, [chatId]: { ...(state.drafts[chatId] ?? EMPTY_DRAFT), ...patch } }
    }))

  return {
    chats: [],
    activeByProject: {},
    items: {},
    drafts: {},
    toggleDefaults: loadToggleDefaults(),
    tuiPtyByChat: {},
    rateLimits: null,
    accounts: [],
    slashCommands: {},
    setRateLimits: (rateLimits) => set({ rateLimits }),
    setAccounts: (accounts) => set({ accounts }),
    loadSlashCommands: async (chatId) => {
      if (get().slashCommands[chatId] || loadingCommands.has(chatId)) return
      loadingCommands.add(chatId)
      try {
        const list = await api.chat.listCommands(chatId)
        set((state) => ({ slashCommands: { ...state.slashCommands, [chatId]: list } }))
      } catch (error) {
        console.error(error)
      } finally {
        loadingCommands.delete(chatId)
      }
    },
    clearChat: (chatId) =>
      set((state) => ({
        items: { ...state.items, [chatId]: [] },
        drafts: withoutKey(state.drafts, chatId)
      })),
    setChats: (chats) => set({ chats }),
    setActiveByProject: (activeByProject) => set({ activeByProject }),
    applyItems: (event) =>
      set((state) => ({
        items: {
          ...state.items,
          [event.chatId]: applyItemsEvent(state.items[event.chatId] ?? [], event)
        }
      })),
    loadHistory: async (chatId) => {
      const history = await api.chat.history(chatId)
      set((state) => ({
        items: {
          ...state.items,
          [chatId]: applyItemsEvent(history, { chatId, upsert: state.items[chatId] })
        }
      }))
    },
    createChat: async (input) => {
      const { chat, draftText } = await api.chat.create(input)
      set((state) => {
        const exists = state.chats.some((c) => c.chatId === chat.chatId)
        return {
          chats: exists
            ? state.chats.map((c) => (c.chatId === chat.chatId ? chat : c))
            : [...state.chats, chat],
          drafts:
            draftText !== undefined
              ? { ...state.drafts, [chat.chatId]: { ...EMPTY_DRAFT, text: draftText } }
              : state.drafts,
          activeByProject: { ...state.activeByProject, [chat.projectKey]: chat.chatId }
        }
      })
      get().setView({ kind: 'project', projectKey: chat.projectKey })
      fire(() => api.chat.setActive(chat.projectKey, chat.chatId))
      const remembered = get().toggleDefaults[chat.projectKey]
      if (
        !chat.started &&
        remembered &&
        (remembered.codex !== chat.toggles.codex || remembered.ultra !== chat.toggles.ultra)
      ) {
        get().updateChat(chat.chatId, { toggles: remembered })
      }
    },
    setActiveTab: (projectKey, tab) => {
      set((state) => ({ activeByProject: { ...state.activeByProject, [projectKey]: tab } }))
      fire(() => api.chat.setActive(projectKey, tab))
    },
    setDraftText: (chatId, text) => patchDraft(chatId, { text }),
    addAttachments: (chatId, attachments) => {
      const current = get().drafts[chatId] ?? EMPTY_DRAFT
      const known = new Set(current.attachments.map((a) => a.path))
      patchDraft(chatId, {
        attachments: [...current.attachments, ...attachments.filter((a) => !known.has(a.path))]
      })
    },
    removeAttachment: (chatId, path) => {
      const current = get().drafts[chatId] ?? EMPTY_DRAFT
      patchDraft(chatId, { attachments: current.attachments.filter((a) => a.path !== path) })
    },
    setWorkspace: (chatId, patch) => {
      const { branchTouched, nameTouched, ...plan } = patch
      const current = get().drafts[chatId] ?? EMPTY_DRAFT
      patchDraft(chatId, {
        workspace: { ...current.workspace, ...plan },
        ...(branchTouched !== undefined ? { branchTouched } : {}),
        ...(nameTouched !== undefined ? { nameTouched } : {})
      })
    },
    sendChat: async (chatId, opts) => {
      const chat = get().chats.find((c) => c.chatId === chatId)
      const draft = get().drafts[chatId] ?? EMPTY_DRAFT
      if (!chat || (!draft.text.trim() && draft.attachments.length === 0)) return
      let workspace: WorkspacePlan | undefined
      if (!chat.started) {
        workspace = { ...draft.workspace }
        if (workspace.newBranch) workspace.branchName = effectiveBranchName(draft)
        else delete workspace.branchName
      }
      patchDraft(chatId, { text: '', attachments: [] })
      try {
        await api.chat.send({
          chatId,
          text: draft.text,
          attachments: draft.attachments,
          toggles: chat.toggles,
          workspace,
          ...(opts?.interrupt ? { interrupt: true } : {})
        })
      } catch (error) {
        console.error(error)
        if (!(get().drafts[chatId]?.text ?? '')) {
          patchDraft(chatId, { text: draft.text, attachments: draft.attachments })
        }
      }
    },
    updateChat: (chatId, patch) => {
      const chat = get().chats.find((c) => c.chatId === chatId)
      if (!chat) return
      set((state) => ({
        chats: state.chats.map((c) => (c.chatId === chatId ? { ...c, ...patch } : c)),
        // Each account has its own skills, so its `/` suggestions must load again.
        ...(patch.account !== undefined ? { slashCommands: withoutKey(state.slashCommands, chatId) } : {}),
        ...(patch.toggles
          ? { toggleDefaults: { ...state.toggleDefaults, [chat.projectKey]: patch.toggles } }
          : {})
      }))
      if (patch.toggles) persistToggleDefaults(get().toggleDefaults)
      fire(() => api.chat.update(chatId, patch))
    },
    closeChat: async (chatId) => {
      const chat = get().chats.find((c) => c.chatId === chatId)
      if (chat) {
        const siblings = get().chats.filter((c) => c.projectKey === chat.projectKey)
        const at = siblings.findIndex((c) => c.chatId === chatId)
        set((state) => {
          const items = withoutKey(state.items, chatId)
          const drafts = withoutKey(state.drafts, chatId)
          const activeByProject =
            state.activeByProject[chat.projectKey] === chatId
              ? {
                  ...state.activeByProject,
                  [chat.projectKey]:
                    siblings[at - 1]?.chatId ?? siblings[at + 1]?.chatId ?? BOARD_TAB
                }
              : state.activeByProject
          return {
            chats: state.chats.filter((c) => c.chatId !== chatId),
            items,
            drafts,
            activeByProject
          }
        })
      }
      try {
        await api.chat.close(chatId)
      } catch (error) {
        console.error(error)
      }
    },
    toggleChatAck: (chatId) => {
      const chat = get().chats.find((c) => c.chatId === chatId)
      if (!chat) return
      const tone = statusTone(chat)
      const patchAck = (acknowledged: boolean): void =>
        set((state) => ({
          chats: state.chats.map((c) => (c.chatId === chatId ? { ...c, acknowledged } : c))
        }))
      if (tone === 'attention') {
        patchAck(true)
        void get().acknowledgeSession(chat.sessionId, chat.statusUpdatedAt ?? 0)
      } else if (chat.acknowledged) {
        patchAck(false)
        void get().unacknowledgeSession(chat.sessionId)
      }
    },
    openInTui: async (chatId) => {
      const { ptyId } = await api.chat.openInTui(chatId)
      set((state) => ({ tuiPtyByChat: { ...state.tuiPtyByChat, [chatId]: ptyId } }))
      get().setDrawerTab('tui')
      get().toggleDrawer(true)
    },
    takeOverChat: async (chatId) => {
      const chat = await api.chat.takeOver(chatId)
      set((state) => ({
        chats: [...state.chats.filter((c) => c.chatId !== chatId && c.chatId !== chat.chatId), chat],
        activeByProject: { ...state.activeByProject, [chat.projectKey]: chat.chatId }
      }))
      fire(() => api.chat.setActive(chat.projectKey, chat.chatId))
    },
    chatsFor: (projectKey) => get().chats.filter((c) => c.projectKey === projectKey),
    activeTabFor: (projectKey) => {
      const tab = get().activeByProject[projectKey]
      return tab && tab !== BOARD_TAB && get().chats.some((c) => c.chatId === tab)
        ? tab
        : BOARD_TAB
    }
  }
}

import { create } from 'zustand'
import { createId } from '../../utils/id.js'
import { translate } from '../../i18n/index.js'
import { DEFAULT_GROUP_ID, DEFAULT_GROUP_NAMES, isDefaultGroup } from './defaultGroup.js'
import { mergeGroupExtras } from './groupExtras.js'
import { prefetchSearchIndex } from './search.js'
import { normalizeSession, selectVersion } from './branches.js'
import * as db from './db.js'
import {
  toSessionSummary,
  type AssistantMessage,
  type Session,
  type SessionGroup,
  type SessionSummary,
} from './types.js'

/** 保留最近打开的详情；当前会话及尚未成功保存的会话不淘汰。 */
const SESSION_CACHE_LIMIT = 5

type ChatState = {
  ready: boolean
  initError: boolean
  /** 历史导入或全部删除期间锁定交互，提交成功前仍展示原有记录。 */
  importingHistory: boolean
  /** 归档组，按导入时间降序。 */
  groups: SessionGroup[]
  /** 仅列表元数据，按 updatedAt 降序。 */
  sessions: SessionSummary[]
  sessionCache: Record<string, Session>
  sessionLoadErrors: Record<string, boolean>
  sessionSaveErrors: Record<string, boolean>
  /** null 表示欢迎页 */
  activeId: string | null
  /** 搜索结果请求的定位：打开会话后滚动到该消息 */
  pendingJump: { sessionId: string; messageId: string } | null
  /** 会话数据的版本号：导入/删除/重命名等递增，用于搜索索引缓存失效 */
  dataVersion: number
  /** 轮次导出选择：sessionId + 初始选中（全部或指定提问） */
  shareSelect: { sessionId: string; initial: 'all' | string[] } | null
}

export const useChatStore = create<ChatState>(() => ({
  ready: false,
  initError: false,
  importingHistory: false,
  groups: [],
  sessions: [],
  sessionCache: {},
  sessionLoadErrors: {},
  sessionSaveErrors: {},
  activeId: null,
  pendingJump: null,
  dataVersion: 0,
  shareSelect: null,
}))

const { getState: get, setState: set } = useChatStore

const bumpDataVersion = () => set((state) => ({ dataVersion: state.dataVersion + 1 }))

/** 记住当前会话，刷新后自动恢复。 */
const ACTIVE_KEY = 'chat-demo:active-session'
const readActiveSession = () => {
  try {
    return localStorage.getItem(ACTIVE_KEY)
  } catch {
    return null
  }
}
const writeActiveSession = (id: string | null) => {
  try {
    if (id === null) {
      localStorage.removeItem(ACTIVE_KEY)
    } else {
      localStorage.setItem(ACTIVE_KEY, id)
    }
  } catch {
    // 存储不可用时忽略
  }
}

// 任何入口切换会话都会经过 activeId，订阅统一落盘。
useChatStore.subscribe((state, previous) => {
  if (state.activeId !== previous.activeId) {
    writeActiveSession(state.activeId)
  }
})

/** 进入当前会话的轮次导出选择模式。 */
export const startShareSelect = (sessionId: string, initial: 'all' | string[] = 'all') => {
  if (get().importingHistory || !get().sessions.some((session) => session.id === sessionId)) {
    return
  }
  touchSession(sessionId)
  set({ activeId: sessionId, shareSelect: { sessionId, initial } })
  void ensureSessionLoaded(sessionId)
  trimSessionCache()
}

export const exitShareSelect = () => {
  if (get().shareSelect !== null) {
    set({ shareSelect: null })
  }
}

const sortSessions = (sessions: SessionSummary[]) =>
  [...sessions].sort((a, b) => b.updatedAt - a.updatedAt)

const getSession = (id: string) => {
  const cache = get().sessionCache
  return Object.hasOwn(cache, id) ? cache[id] : undefined
}

const sameSummary = (a: SessionSummary, b: SessionSummary) =>
  a.title === b.title && a.createdAt === b.createdAt && a.updatedAt === b.updatedAt

const sessionAccess = new Map<string, number>()
const unsavedSessions = new Set<string>()
/** 保存失败时保留原件，重试成功后才释放。 */
const deletingSessions = new Set<string>()
const deletionTasks = new Set<Promise<boolean>>()
let accessSequence = 0
let historyEpoch = 0
let initTask: Promise<void> | undefined
const sessionLoads = new Map<string, { promise: Promise<void> }>()

const touchSession = (id: string) => sessionAccess.set(id, ++accessSequence)

const trimSessionCache = () => {
  const state = get()
  const ids = Object.keys(state.sessionCache)
  if (ids.length <= SESSION_CACHE_LIMIT) {
    return
  }
  const removable = ids
    .filter((id) => id !== state.activeId && !unsavedSessions.has(id) && !deletingSessions.has(id))
    .sort((a, b) => (sessionAccess.get(a) ?? 0) - (sessionAccess.get(b) ?? 0))
  const evicted = new Set(removable.slice(0, ids.length - SESSION_CACHE_LIMIT))
  for (const id of evicted) {
    sessionAccess.delete(id)
  }
  if (evicted.size > 0) {
    set({
      sessionCache: Object.fromEntries(
        Object.entries(state.sessionCache).filter(([id]) => !evicted.has(id))
      ),
    })
  }
}

const updateSession = (id: string, update: (session: Session) => Session) =>
  set((state) => {
    const previous = Object.hasOwn(state.sessionCache, id) ? state.sessionCache[id] : undefined
    if (!previous) {
      return state
    }
    const session = update(previous)
    if (session === previous) {
      return state
    }
    return {
      sessionCache: { ...state.sessionCache, [id]: session },
      sessions: sameSummary(previous, session)
        ? state.sessions
        : sortSessions(
            state.sessions.map((summary) =>
              summary.id === id ? toSessionSummary(session) : summary
            )
          ),
    }
  })

const persist = (sessionId: string) => {
  const session = getSession(sessionId)
  if (session) {
    unsavedSessions.add(sessionId)
    if (deletingSessions.has(sessionId)) {
      return
    }
    const epoch = historyEpoch
    void db
      .saveSession(session)
      .then(() => {
        if (epoch !== historyEpoch || !getSession(sessionId)) {
          return
        }
        if (getSession(sessionId) === session) {
          unsavedSessions.delete(sessionId)
          set((state) => ({
            sessionSaveErrors: Object.fromEntries(
              Object.entries(state.sessionSaveErrors).filter(([id]) => id !== sessionId)
            ),
          }))
          trimSessionCache()
        }
      })
      .catch((error: unknown) => {
        db.reportStorageError('save session')(error)
        if (epoch === historyEpoch && getSession(sessionId)) {
          set((state) => ({
            sessionSaveErrors: { ...state.sessionSaveErrors, [sessionId]: true },
          }))
        }
      })
  }
}

export const retrySaveSessions = () => {
  if (!get().importingHistory) {
    unsavedSessions.forEach(persist)
  }
}

/** 离开前保存尚未落盘的修改。 */
export const bindChatPersistence = () => {
  const save = () => {
    if (get().importingHistory) {
      return
    }
    for (const id of unsavedSessions) {
      persist(id)
    }
  }
  const onVisibilityChange = () => {
    if (document.visibilityState === 'hidden') {
      save()
    }
  }
  document.addEventListener('visibilitychange', onVisibilityChange)
  window.addEventListener('pagehide', save)
  return () => {
    document.removeEventListener('visibilitychange', onVisibilityChange)
    window.removeEventListener('pagehide', save)
  }
}

/** 旧客户端留下的未完成回复按「已停止」处理：收尾思考块的时间。 */
const settleInterrupted = (session: Session): Session => {
  if (
    !session.messages.some(
      (m) => m.role === 'assistant' && (m.status === 'pending' || m.status === 'streaming')
    )
  ) {
    return session
  }
  return {
    ...session,
    messages: session.messages.map((m) => {
      if (m.role !== 'assistant' || (m.status !== 'pending' && m.status !== 'streaming')) {
        return m
      }
      const reply: AssistantMessage = { ...m, status: 'stopped' }
      reply.blocks = reply.blocks.map((block) =>
        block.type === 'thinking' && block.startedAt !== undefined && block.endedAt === undefined
          ? { ...block, endedAt: session.updatedAt }
          : block
      )
      return reply
    }),
  }
}

export const initChat = (): Promise<void> => {
  if (get().ready) {
    return Promise.resolve()
  }
  if (initTask) {
    return initTask
  }
  const epoch = historyEpoch
  set({ initError: false })
  initTask = (async () => {
    try {
      void db.requestPersistentStorage()
      let [summaries, groups] = await Promise.all([db.loadSessionSummaries(), db.loadGroups()])
      // 确保默认组存在，并把历史遗留的 null 组会话迁入
      let defaultGroup = groups.find((group) => isDefaultGroup(group.id))
      if (!defaultGroup) {
        defaultGroup = {
          id: DEFAULT_GROUP_ID,
          name: translate('defaultGroupName'),
          nameCustomized: false,
          color: null,
          sourceName: '',
          createdAt: 0,
        }
        await db.saveGroup(defaultGroup)
        groups = [...groups, defaultGroup]
      } else if (!defaultGroup.nameCustomized) {
        const defaultName = translate('defaultGroupName')
        if (defaultGroup.name !== defaultName) {
          // 升级前的旧默认组没有标记：名字仍是内置名就跟随语言，否则视为用户改过名
          defaultGroup = DEFAULT_GROUP_NAMES.has(defaultGroup.name)
            ? { ...defaultGroup, name: defaultName }
            : { ...defaultGroup, nameCustomized: true }
          await db.saveGroup(defaultGroup)
        }
      }
      const resolvedDefault = defaultGroup
      groups = groups.map((group) => (isDefaultGroup(group.id) ? resolvedDefault : group))
      const ungrouped = summaries.filter((session) => session.groupId === null)
      if (ungrouped.length > 0) {
        await db.moveSessionsToGroup(
          ungrouped.map((session) => session.id),
          DEFAULT_GROUP_ID
        )
        summaries = summaries.map((session) =>
          session.groupId === null ? { ...session, groupId: DEFAULT_GROUP_ID } : session
        )
      }
      if (epoch === historyEpoch) {
        const sorted = sortSessions(summaries)
        const savedActive = readActiveSession()
        const restoreActive =
          savedActive !== null && sorted.some((session) => session.id === savedActive)
            ? savedActive
            : null
        set({
          ready: true,
          sessions: sorted,
          groups: groups.sort((a, b) => b.createdAt - a.createdAt),
          activeId: restoreActive,
        })
        prefetchSearchIndex(sorted, get().dataVersion)
        if (restoreActive !== null) {
          void ensureSessionLoaded(restoreActive)
        }
      }
    } catch (error) {
      if (epoch === historyEpoch) {
        set({ initError: true })
        db.reportStorageError('read local sessions')(error)
      }
    } finally {
      if (epoch === historyEpoch) {
        initTask = undefined
      }
    }
  })()
  return initTask
}

/** 同一会话合并并发读取；切换只改变 activeId，旧请求不会把界面切回去。 */
const ensureSessionLoaded = (id: string): Promise<void> => {
  if (getSession(id)) {
    return Promise.resolve()
  }
  const pending = sessionLoads.get(id)
  if (pending) {
    return pending.promise
  }
  const epoch = historyEpoch
  set((state) => ({ sessionLoadErrors: { ...state.sessionLoadErrors, [id]: false } }))
  const load = { promise: Promise.resolve() }
  sessionLoads.set(id, load)
  load.promise = (async () => {
    try {
      const stored = await db.loadSession(id)
      if (epoch !== historyEpoch || sessionLoads.get(id) !== load) {
        return
      }
      const summary = get().sessions.find((session) => session.id === id)
      if (!summary) {
        return
      }
      if (!stored) {
        throw new Error(`Session ${id} is missing from local storage`)
      }
      const settled = settleInterrupted(normalizeSession(stored))
      // 读取期间可能已在列表重命名，保留最新元数据，不能让旧读取覆盖它。
      const session = sameSummary(settled, summary) ? settled : { ...settled, ...summary }
      touchSession(id)
      set((state) => ({ sessionCache: { ...state.sessionCache, [id]: session } }))
      if (session !== stored) {
        persist(id)
      }
      trimSessionCache()
    } catch (error) {
      if (epoch === historyEpoch && sessionLoads.get(id) === load) {
        set((state) => ({ sessionLoadErrors: { ...state.sessionLoadErrors, [id]: true } }))
        db.reportStorageError('read session')(error)
      }
    } finally {
      if (sessionLoads.get(id) === load) {
        sessionLoads.delete(id)
      }
    }
  })()
  return load.promise
}

/**
 * 增量导入：先写入暂存，成功后按新组提交；失败时清除暂存，不影响已有数据。
 * 期间禁止修改会话；提交后清空详情缓存并合并列表。
 */
export const addHistoryGroup = async (
  group: SessionGroup,
  write: () => Promise<void>
): Promise<number> => {
  if (get().importingHistory) {
    throw new Error('History import is already in progress')
  }
  set({ importingHistory: true })
  try {
    // 已开始的单条删除先同步到内存，避免列表残留已被删除的记录。
    await Promise.all(deletionTasks)
    historyEpoch += 1
    initTask = undefined
    sessionLoads.clear()
    await db.clearStaging()
    let summaries: SessionSummary[]
    try {
      await write()
      summaries = await db.commitStagedGroup(group)
    } catch (error) {
      await db.clearStaging().catch(db.reportStorageError('clear unfinished history import'))
      throw error
    }
    sessionAccess.clear()
    unsavedSessions.clear()
    set((state) => ({
      ready: true,
      initError: false,
      groups: [...state.groups, group].sort((a, b) => b.createdAt - a.createdAt),
      sessions: sortSessions([...state.sessions, ...summaries]),
      sessionCache: {},
      sessionLoadErrors: {},
      sessionSaveErrors: {},
      dataVersion: state.dataVersion + 1,
    }))
    return summaries.length
  } finally {
    set({ importingHistory: false })
    retrySaveSessions()
    const { activeId } = get()
    // 当前会话的详情缓存已清空，重新加载。
    if (activeId !== null) {
      void ensureSessionLoaded(activeId)
    }
  }
}

/** 删除全部会话、归档组与附件，保留语言主题等设置。 */
export const clearAllHistory = async (): Promise<void> => {
  if (get().importingHistory) {
    throw new Error('History import is already in progress')
  }
  set({ importingHistory: true })
  try {
    await Promise.all(deletionTasks)
    historyEpoch += 1
    initTask = undefined
    sessionLoads.clear()
    sessionAccess.clear()
    unsavedSessions.clear()
    await db.clearAllData()
    const defaultGroup: SessionGroup = {
      id: DEFAULT_GROUP_ID,
      name: translate('defaultGroupName'),
      nameCustomized: false,
      color: null,
      sourceName: '',
      createdAt: 0,
    }
    await db.saveGroup(defaultGroup)
    set((state) => ({
      ready: true,
      sessions: [],
      groups: [defaultGroup],
      sessionCache: {},
      sessionLoadErrors: {},
      sessionSaveErrors: {},
      activeId: null,
      dataVersion: state.dataVersion + 1,
    }))
  } finally {
    set({ importingHistory: false })
    retrySaveSessions()
    const { activeId, ready } = get()
    if (activeId !== null) {
      void ensureSessionLoaded(activeId)
    } else if (!ready) {
      void initChat()
    }
  }
}

/** 打开欢迎页。 */
export const newChat = () => {
  if (!get().importingHistory) {
    set({ activeId: null })
    trimSessionCache()
  }
}

export const selectSession = (id: string) => {
  if (!get().importingHistory && get().sessions.some((session) => session.id === id)) {
    touchSession(id)
    set({ activeId: id })
    void ensureSessionLoaded(id)
    trimSessionCache()
  }
}

/** 打开另一个会话，并定位到外部归档里的原始消息 ID。 */
export const openSessionExternalMessage = async (
  sessionId: string,
  externalId?: string
): Promise<void> => {
  if (!get().sessions.some((session) => session.id === sessionId)) {
    return
  }
  if (!externalId) {
    selectSession(sessionId)
    return
  }
  const loaded = getSession(sessionId) ?? (await db.loadSession(sessionId))
  const message = loaded?.messages.find((item) => item.externalId === externalId)
  if (message) {
    openSessionMessage(sessionId, message.id)
  } else {
    selectSession(sessionId)
  }
}

/** 从搜索结果打开会话并定位到命中消息。 */
export const openSessionMessage = (sessionId: string, messageId: string) => {
  if (get().importingHistory || !get().sessions.some((session) => session.id === sessionId)) {
    return
  }
  touchSession(sessionId)
  set({ activeId: sessionId, pendingJump: { sessionId, messageId } })
  void ensureSessionLoaded(sessionId)
  trimSessionCache()
}

/** 定位已消费（或会话已切换）后清除。 */
export const clearPendingJump = () => {
  if (get().pendingJump !== null) {
    set({ pendingJump: null })
  }
}

export const renameSession = (id: string, title: string) => {
  if (get().importingHistory || deletingSessions.has(id)) {
    return
  }
  if (getSession(id)) {
    updateSession(id, (session) => ({ ...session, title }))
    persist(id)
    bumpDataVersion()
  } else {
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === id ? { ...session, title } : session
      ),
    }))
    void db.renameSession(id, title).catch(db.reportStorageError('rename session'))
    bumpDataVersion()
  }
}

/** 删除会话；本地原件仅在没有其他会话引用时清理。 */
export const removeSession = (id: string): Promise<boolean> => {
  const task = removeSessionData(id).finally(() => deletionTasks.delete(task))
  deletionTasks.add(task)
  return task
}

const removeSessionData = async (id: string): Promise<boolean> => {
  if (get().importingHistory || deletingSessions.has(id)) {
    return false
  }
  const epoch = historyEpoch
  deletingSessions.add(id)
  try {
    if (epoch !== historyEpoch) {
      return false
    }
    await db.deleteSession(id)
    if (epoch !== historyEpoch) {
      return true
    }
    sessionLoads.delete(id)
    sessionAccess.delete(id)
    unsavedSessions.delete(id)
    set((state) => ({
      sessions: state.sessions.filter((session) => session.id !== id),
      sessionCache: Object.fromEntries(
        Object.entries(state.sessionCache).filter(([key]) => key !== id)
      ),
      sessionLoadErrors: Object.fromEntries(
        Object.entries(state.sessionLoadErrors).filter(([key]) => key !== id)
      ),
      sessionSaveErrors: Object.fromEntries(
        Object.entries(state.sessionSaveErrors).filter(([key]) => key !== id)
      ),
      activeId: state.activeId === id ? null : state.activeId,
      dataVersion: state.dataVersion + 1,
    }))
    return true
  } catch (error) {
    db.reportStorageError('delete session')(error)
    return false
  } finally {
    deletingSessions.delete(id)
    // 删除失败时保留会话，并保存当前状态。
    if (getSession(id)) {
      if (get().importingHistory) {
        unsavedSessions.add(id)
      } else {
        persist(id)
      }
    }
  }
}

/** 只读切换消息版本；纯内存操作，不产生持久化写入以外的副作用。 */
export const selectMessageVersion = (sessionId: string, messageId: string) => {
  if (get().importingHistory || deletingSessions.has(sessionId)) {
    return
  }
  updateSession(sessionId, (session) => selectVersion(session, messageId))
  persist(sessionId)
}

// ---------- 归档组管理 ----------

const patchSessionGroups = (ids: string[], groupId: string | null) => {
  const idSet = new Set(ids)
  set((state) => ({
    sessions: state.sessions.map((session) =>
      idSet.has(session.id) ? { ...session, groupId } : session
    ),
    sessionCache: Object.fromEntries(
      Object.entries(state.sessionCache).map(([id, session]) =>
        idSet.has(id) ? [id, { ...session, groupId }] : [id, session]
      )
    ),
  }))
}

export const renameGroup = (id: string, name: string) => {
  const group = get().groups.find((item) => item.id === id)
  if (!group) {
    return
  }
  const next = isDefaultGroup(id) ? { ...group, name, nameCustomized: true } : { ...group, name }
  set((state) => ({
    groups: state.groups.map((item) => (item.id === id ? next : item)),
  }))
  void db.saveGroup(next).catch(db.reportStorageError('rename group'))
}

/** 界面语言变化时同步未改名的默认组；改过名（含改成同名）则保持用户命名。 */
export const syncDefaultGroupName = (name: string) => {
  const group = get().groups.find((item) => isDefaultGroup(item.id))
  if (!group || group.nameCustomized || group.name === name) {
    return
  }
  const next = { ...group, name }
  set((state) => ({
    groups: state.groups.map((item) => (item.id === group.id ? next : item)),
  }))
  void db.saveGroup(next).catch(db.reportStorageError('sync default group name'))
}

export const setGroupColor = (id: string, color: string | null) => setGroupsColor([id], color)

/** 移动会话到组；groupId 为 null 表示取消分组。 */
export const moveSessionsToGroup = async (ids: string[], groupId: string | null) => {
  if (get().importingHistory || ids.length === 0) {
    return
  }
  try {
    await db.moveSessionsToGroup(ids, groupId)
    patchSessionGroups(ids, groupId)
  } catch (error) {
    db.reportStorageError('move sessions')(error)
    throw error
  }
}

/** 批量设置置顶。 */
export const setSessionsPinned = async (ids: string[], pinned: boolean) => {
  if (get().importingHistory || ids.length === 0) {
    return
  }
  try {
    await db.pinSessions(ids, pinned)
    const idSet = new Set(ids)
    set((state) => ({
      sessions: state.sessions.map((session) =>
        idSet.has(session.id) ? { ...session, pinned } : session
      ),
      sessionCache: Object.fromEntries(
        Object.entries(state.sessionCache).map(([id, session]) =>
          idSet.has(id) ? [id, { ...session, pinned }] : [id, session]
        )
      ),
    }))
  } catch (error) {
    db.reportStorageError('pin sessions')(error)
    throw error
  }
}

/** 新建空归档组，返回组记录（已入库并入列表）。 */
export const createGroup = async (name: string): Promise<SessionGroup> => {
  const group: SessionGroup = {
    id: createId(),
    name,
    color: null,
    sourceName: '',
    createdAt: Date.now(),
  }
  await db.saveGroup(group)
  set((state) => ({
    groups: [...state.groups, group].sort((a, b) => b.createdAt - a.createdAt),
  }))
  return group
}

/** 合并组：源组的会话与附加信息并入目标组后删除源组。 */
export const mergeGroupsInto = async (sourceIds: string[], targetId: string) => {
  if (get().importingHistory) {
    return
  }
  const state = get()
  const target = state.groups.find((group) => group.id === targetId)
  const sourceSet = new Set(sourceIds.filter((id) => id !== targetId && !isDefaultGroup(id)))
  if (!target || sourceSet.size === 0) {
    return
  }
  const sources = state.groups.filter((group) => sourceSet.has(group.id))
  if (sources.length === 0) {
    return
  }
  const ids = state.sessions
    .filter((session) => session.groupId !== null && sourceSet.has(session.groupId))
    .map((session) => session.id)
  const extras = mergeGroupExtras(target, sources)
  const nextTarget: SessionGroup = extras.length > 0 ? { ...target, extras } : { ...target }
  try {
    if (ids.length > 0) {
      await db.moveSessionsToGroup(ids, targetId)
    }
    await db.saveGroup(nextTarget)
    await Promise.all(sources.map((group) => db.deleteGroupRecord(group.id)))
  } catch (error) {
    db.reportStorageError('merge groups')(error)
    throw error
  }
  patchSessionGroups(ids, targetId)
  set((current) => ({
    groups: current.groups
      .map((group) => (group.id === targetId ? nextTarget : group))
      .filter((group) => !sourceSet.has(group.id)),
  }))
}

/** 单个组合并到目标组；保留现有单组合并调用的语义。 */
export const mergeGroups = (sourceId: string, targetId: string) =>
  mergeGroupsInto([sourceId], targetId)

/** 合并多个组为新组；先建组，再复用 mergeGroupsInto 合并会话与附加信息。 */
export const mergeGroupsIntoNew = async (
  sourceIds: string[],
  name: string
): Promise<SessionGroup | null> => {
  const trimmed = name.trim()
  if (!trimmed || get().importingHistory || sourceIds.some(isDefaultGroup)) {
    return null
  }
  const sources = get().groups.filter((group) => sourceIds.includes(group.id))
  if (sources.length === 0) {
    return null
  }
  const group = await createGroup(trimmed)
  try {
    await mergeGroupsInto(sourceIds, group.id)
    return group
  } catch (error) {
    // 合并失败时清理刚创建的空组，避免留下半成品；源组仍完整保留。
    if (!get().sessions.some((session) => session.groupId === group.id)) {
      await db.deleteGroupRecord(group.id).catch(() => {})
      set((state) => ({ groups: state.groups.filter((item) => item.id !== group.id) }))
    }
    throw error
  }
}

/** 批量设置组颜色。 */
export const setGroupsColor = async (ids: string[], color: string | null) => {
  if (get().importingHistory || ids.length === 0) {
    return
  }
  const idSet = new Set(ids)
  const current = get().groups.filter((group) => idSet.has(group.id))
  if (current.length === 0) {
    return
  }
  const updates = current.map((group) => ({ ...group, color }))
  try {
    await Promise.all(updates.map((group) => db.saveGroup(group)))
  } catch (error) {
    db.reportStorageError('set group colors')(error)
    throw error
  }
  const byId = new Map(updates.map((group) => [group.id, group]))
  set((state) => ({
    groups: state.groups.map((group) => byId.get(group.id) ?? group),
  }))
}

/** 批量删除组及其会话；默认组不可删除。 */
export const removeGroups = async (ids: string[]): Promise<boolean> => {
  if (get().importingHistory || deletingSessions.size > 0) {
    return false
  }
  const groupIds = [...new Set(ids)]
  if (groupIds.length === 0 || groupIds.some(isDefaultGroup)) {
    return false
  }
  const groupIdSet = new Set(groupIds)
  const state = get()
  if (!state.groups.some((group) => groupIdSet.has(group.id))) {
    return false
  }
  const sessionIds = state.sessions
    .filter((session) => session.groupId !== null && groupIdSet.has(session.groupId))
    .map((session) => session.id)
  try {
    if (sessionIds.length > 0) {
      await db.deleteSessions(sessionIds)
    }
    await Promise.all(groupIds.map((id) => db.deleteGroupRecord(id)))
  } catch (error) {
    db.reportStorageError('delete groups')(error)
    return false
  }
  const sessionIdSet = new Set(sessionIds)
  set((current) => ({
    groups: current.groups.filter((group) => !groupIdSet.has(group.id)),
    sessions: current.sessions.filter((session) => !sessionIdSet.has(session.id)),
    sessionCache: Object.fromEntries(
      Object.entries(current.sessionCache).filter(([key]) => !sessionIdSet.has(key))
    ),
    sessionLoadErrors: Object.fromEntries(
      Object.entries(current.sessionLoadErrors).filter(([key]) => !sessionIdSet.has(key))
    ),
    sessionSaveErrors: Object.fromEntries(
      Object.entries(current.sessionSaveErrors).filter(([key]) => !sessionIdSet.has(key))
    ),
    activeId:
      current.activeId !== null && sessionIdSet.has(current.activeId) ? null : current.activeId,
    dataVersion: current.dataVersion + 1,
  }))
  return true
}

/** 批量删除会话；本地原件仅在没有其他会话引用时清理。 */
export const removeSessions = async (ids: string[]): Promise<boolean> => {
  if (get().importingHistory || deletingSessions.size > 0) {
    return false
  }
  const idSet = new Set(ids)
  try {
    await db.deleteSessions(ids)
    for (const id of ids) {
      sessionLoads.delete(id)
      sessionAccess.delete(id)
      unsavedSessions.delete(id)
    }
    set((state) => ({
      sessions: state.sessions.filter((session) => !idSet.has(session.id)),
      sessionCache: Object.fromEntries(
        Object.entries(state.sessionCache).filter(([key]) => !idSet.has(key))
      ),
      sessionLoadErrors: Object.fromEntries(
        Object.entries(state.sessionLoadErrors).filter(([key]) => !idSet.has(key))
      ),
      sessionSaveErrors: Object.fromEntries(
        Object.entries(state.sessionSaveErrors).filter(([key]) => !idSet.has(key))
      ),
      activeId: state.activeId !== null && idSet.has(state.activeId) ? null : state.activeId,
      dataVersion: state.dataVersion + 1,
    }))
    return true
  } catch (error) {
    db.reportStorageError('delete sessions')(error)
    return false
  }
}

/** 删除组及其全部会话；本地原件仅在没有其他会话引用时清理。 */
export const removeGroup = (id: string): Promise<boolean> => removeGroups([id])

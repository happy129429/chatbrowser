import clsx from 'clsx'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  IconDarkOutline16,
  IconDataOutline16,
  IconDownloadOutline16,
  IconFollowsystemOutline16,
  IconInfoOutline16,
  IconPowerOutline16,
  IconLightOutline16,
  IconSettingsOutline16,
  IconStatsOutline16,
  IconUploadOutline14,
} from '../base/icons.js'
import {
  BackupError,
  clearHistory,
  exportHistory,
  importArchiveFiles,
} from '../../services/chat/backup.js'
import { useChatStore } from '../../services/chat/store.js'
import {
  setLocalePreference,
  setThemePreference,
  useSettings,
  type LocalePreference,
  type ThemePreference,
} from '../../services/settings.js'
import { useTranslate, type TranslationKey, type TranslationMessage } from '../../i18n/index.js'
import { collectChatStats, type ChatStats } from '../../services/chat/stats.js'
import { quitLauncher, isLauncherOrigin } from '../../services/launcher.js'
import { checkForUpdates, RELEASES_URL, type UpdateResult } from '../../services/update.js'
import { saveBlob } from '../../utils/saveFile.js'
import { Button } from '../base/Button.js'
import { Modal } from '../base/Modal.js'
import { Select } from '../base/Select.js'
import { showToast } from '../base/toastState.js'
import { closeSettings, useSettingsDialog, type SettingsSection } from './settingsDialogState.js'
import styles from './Settings.module.css'

/**
 * 设置弹窗：分「通用设置」（主题、语言）与「数据管理」（导入、导出、删除）。
 * 桌面端为居中弹窗、左侧导航；移动端为底部弹层、导航横排在内容上方
 */
export const SettingsDialog = () => {
  const open = useSettingsDialog((state) => state.open)
  return open ? <SettingsContent /> : null
}

const sections: { value: SettingsSection; label: TranslationKey; icon: ReactNode }[] = [
  {
    value: 'general',
    label: 'settingDialogAsideGeneralOptionLabel',
    icon: <IconSettingsOutline16 />,
  },
  { value: 'stats', label: 'settingDialogAsideStatsOptionLabel', icon: <IconStatsOutline16 /> },
  { value: 'data', label: 'settingDialogAsideDataOptionLabel', icon: <IconDataOutline16 /> },
  { value: 'about', label: 'settingDialogAsideAboutOptionLabel', icon: <IconInfoOutline16 /> },
]

const SettingsContent = () => {
  const t = useTranslate()
  // 打开时按调用方指定的分组选中，之后在弹窗内切换
  const [section, setSection] = useState(() => useSettingsDialog.getState().section)
  // 切换分组不丢失导入状态
  const historyImport = useHistoryImport()
  const historyDelete = useHistoryDelete()
  const replacingHistory = useChatStore((state) => state.importingHistory)
  const historyBusy = historyImport.busy || historyDelete.busy || replacingHistory
  return (
    <>
      <Modal
        title={t('settings')}
        closable
        className={styles.dialog}
        mainClassName={styles.dialogMain}
        onClose={() => {
          if (!historyDelete.busy) {
            closeSettings()
          }
        }}
      >
        <div role="tablist" className={styles.navigation}>
          {(isLauncherOrigin()
            ? [
                ...sections,
                {
                  value: 'quit' as const,
                  label: 'settingDialogAsideQuitOptionLabel' as const,
                  icon: <IconPowerOutline16 />,
                },
              ]
            : sections
          ).map((item) => (
            <button
              key={item.value}
              type="button"
              role="tab"
              aria-selected={section === item.value}
              className={clsx(styles.navItem, section === item.value && styles.navItemActive)}
              onClick={() => setSection(item.value)}
            >
              {item.icon}
              {t(item.label)}
            </button>
          ))}
        </div>
        <div role="tabpanel" className={styles.content}>
          {section === 'general' ? (
            <>
              <ThemeSetting />
              <LocaleSetting />
            </>
          ) : section === 'stats' ? (
            <ChatStats />
          ) : section === 'about' ? (
            <AboutPanel />
          ) : section === 'quit' ? (
            <QuitPanel />
          ) : (
            <>
              <ImportHistory historyImport={historyImport} disabled={historyBusy} />
              <ExportHistory disabled={historyBusy} />
              <SettingCell
                label={t('deleteAllSessions')}
                status={null}
                action={
                  <Button
                    variant="dangerOutlined"
                    size="m"
                    className={styles.cellButton}
                    disabled={historyBusy}
                    onClick={historyDelete.open}
                  >
                    {t('delete')}
                  </Button>
                }
              />
            </>
          )}
        </div>
      </Modal>
      {historyDelete.opened ? <DeleteAllConfirm historyDelete={historyDelete} /> : null}
    </>
  )
}

/** 删除确认保留在设置之上；失败可重试，成功只关闭确认弹窗。 */
const DeleteAllConfirm = ({
  historyDelete,
}: {
  historyDelete: ReturnType<typeof useHistoryDelete>
}) => {
  const t = useTranslate()
  return (
    <Modal
      title={t('deleteAllSessionsModalTitle')}
      className={styles.deleteConfirm}
      onClose={historyDelete.cancel}
      footer={
        <div className={styles.deleteActions} aria-busy={historyDelete.busy}>
          <Button
            variant="outlined"
            autoFocus
            disabled={historyDelete.busy}
            onClick={historyDelete.cancel}
          >
            {t('cancel')}
          </Button>
          <Button
            variant="danger"
            disabled={historyDelete.busy}
            onClick={() => void historyDelete.confirm()}
          >
            {t(historyDelete.busy ? 'historyDeleting' : 'deleteAllSessions')}
          </Button>
        </div>
      }
    >
      {t('deleteAllSessionsModalDescription')}
    </Modal>
  )
}

const useHistoryDelete = () => {
  const [opened, setOpened] = useState(false)
  const [busy, setBusy] = useState(false)
  const deleting = useRef(false)

  const confirm = async () => {
    if (deleting.current) {
      return
    }
    deleting.current = true
    setBusy(true)
    try {
      await clearHistory()
      setOpened(false)
      showToast({ key: 'historyDeleted' })
    } catch {
      showToast({ key: 'historyDeleteFailed', type: 'error' })
    } finally {
      deleting.current = false
      setBusy(false)
    }
  }

  return {
    opened,
    busy,
    open: () => setOpened(true),
    cancel: () => {
      if (!deleting.current) {
        setOpened(false)
      }
    },
    confirm,
  }
}

/** 退出应用：停止启动器的本地服务并释放程序文件。 */
const QuitPanel = () => {
  const t = useTranslate()
  return (
    <SettingCell
      label={t('aboutQuit')}
      description={t('aboutQuitHint')}
      status={null}
      action={
        <Button
          variant="dangerOutlined"
          size="m"
          className={styles.cellButton}
          onClick={() => void quitLauncher()}
        >
          {t('aboutQuitAction')}
        </Button>
      }
    />
  )
}

/** 关于：版本、检查更新、项目地址、上游项目与许可（应用内查看许可证）。 */
const AboutPanel = () => {
  const t = useTranslate()
  const [checking, setChecking] = useState(false)
  const [update, setUpdate] = useState<'latest' | 'newer' | 'failed' | null>(null)
  const [latest, setLatest] = useState<UpdateResult | null>(null)
  const [licenseOpen, setLicenseOpen] = useState(false)
  const [licenseText, setLicenseText] = useState('')

  useEffect(() => {
    if (!licenseOpen || licenseText) {
      return
    }
    let active = true
    fetch('/LICENSE')
      .then((response) => (response.ok ? response.text() : ''))
      .then((text) => {
        if (active) {
          setLicenseText(text || 'LICENSE')
        }
      })
      .catch(() => {
        if (active) {
          setLicenseText('LICENSE')
        }
      })
    return () => {
      active = false
    }
  }, [licenseOpen, licenseText])

  const checkUpdate = async () => {
    setChecking(true)
    setUpdate(null)
    const result = await checkForUpdates(true)
    setChecking(false)
    if (!result) {
      setUpdate('failed')
      return
    }
    setLatest(result)
    setUpdate(result.newer ? 'newer' : 'latest')
  }

  const updateDescription =
    update === 'newer'
      ? t('aboutNewVersion', { version: latest?.latest ?? '' })
      : update === 'latest'
        ? t('aboutUpToDate')
        : update === 'failed'
          ? t('aboutCheckFailed')
          : undefined

  return (
    <>
      <SettingCell
        label={t('aboutVersion')}
        status={null}
        action={<span className={styles.statValue}>v{__APP_VERSION__}</span>}
      />
      <SettingCell
        label={t('aboutCheckUpdate')}
        description={updateDescription}
        status={null}
        action={
          <div className={styles.cellActions}>
            <Button
              variant="outlined"
              size="m"
              className={styles.cellButton}
              disabled={checking}
              onClick={() => void checkUpdate()}
            >
              {t(checking ? 'aboutChecking' : 'aboutCheckNow')}
            </Button>
            {update === 'newer' ? (
              <Button
                variant="primary"
                size="m"
                className={styles.cellButton}
                onClick={() => window.open(latest?.url ?? RELEASES_URL, '_blank')}
              >
                {t('aboutDownload')}
              </Button>
            ) : null}
          </div>
        }
      />
      <SettingCell
        label={t('aboutProject')}
        status={null}
        action={
          <a
            className={styles.statValue}
            href={RELEASES_URL.replace(/\/releases$/, '')}
            target="_blank"
            rel="noreferrer"
          >
            github.com/happy129429/chatbrowser
          </a>
        }
      />
      <SettingCell
        label={t('aboutUpstream')}
        status={null}
        action={
          <a
            className={styles.statValue}
            href="https://github.com/deepseek-ai/chat-demo"
            target="_blank"
            rel="noreferrer"
          >
            deepseek-ai/chat-demo
          </a>
        }
      />
      <SettingCell
        label={t('aboutLicense')}
        status={null}
        action={
          <a
            className={styles.statValue}
            href="/LICENSE"
            onClick={(event) => {
              event.preventDefault()
              setLicenseOpen(true)
            }}
          >
            GPL-3.0-or-later
          </a>
        }
      />
      {licenseOpen ? (
        <Modal
          title={t('aboutLicense')}
          closable
          className={styles.licenseDialog}
          onClose={() => setLicenseOpen(false)}
          footer={
            <Button variant="outlined" onClick={() => setLicenseOpen(false)}>
              {t('close')}
            </Button>
          }
        >
          <pre className={styles.licenseText}>{licenseText || '…'}</pre>
        </Modal>
      ) : null}
    </>
  )
}

/** 遍历本地库汇总统计：组数、会话数、轮数、token 用量与思考时长。 */
const ChatStats = () => {
  const t = useTranslate()
  const [stats, setStats] = useState<ChatStats | null>(null)

  useEffect(() => {
    let active = true
    void collectChatStats().then((result) => {
      if (active) {
        setStats(result)
      }
    })
    return () => {
      active = false
    }
  }, [])

  const formatSeconds = (seconds: number) =>
    seconds < 90
      ? t('statsSeconds', { count: seconds })
      : t('statsMinutes', { count: Math.round(seconds / 60) })

  return (
    <>
      {stats === null ? (
        <SettingCell label={t('statsScanning')} status={null} />
      ) : (
        <>
          <SettingCell
            label={t('statsGroups')}
            status={null}
            action={<span className={styles.statValue}>{stats.groups}</span>}
          />
          <SettingCell
            label={t('statsSessions')}
            status={null}
            action={<span className={styles.statValue}>{stats.sessions}</span>}
          />
          <SettingCell
            label={t('statsRounds')}
            status={null}
            action={<span className={styles.statValue}>{stats.rounds}</span>}
          />
          <SettingCell
            label={t('statsTokens')}
            status={null}
            action={
              <span className={styles.statValue}>
                {stats.tokens === null ? '—' : stats.tokens.toLocaleString('en-US')}
              </span>
            }
          />
          <SettingCell
            label={t('statsThinking')}
            status={null}
            action={
              <span className={styles.statValue}>
                {stats.thinkSeconds === null ? '—' : formatSeconds(stats.thinkSeconds)}
              </span>
            }
          />
        </>
      )}
    </>
  )
}

const LocaleSetting = () => {
  const t = useTranslate()
  const localePreference = useSettings((state) => state.localePreference)
  return (
    <SettingCell
      label={t('settingsLocalePreference')}
      status={null}
      action={
        <Select
          ariaLabel={t('settingsLocalePreference')}
          value={localePreference}
          options={[
            { value: 'system', label: t('settingsLocaleSystem') },
            { value: 'zh-CN', label: t('settingsLocaleZhCN'), lang: 'zh-CN' },
            { value: 'en-US', label: t('settingsLocaleEnUS'), lang: 'en' },
          ]}
          onChange={(value) => setLocalePreference(value as LocalePreference)}
        />
      }
    />
  )
}

const themeOptions: { value: ThemePreference; label: TranslationKey; icon: ReactNode }[] = [
  {
    value: 'light',
    label: 'avatarMenuSettingsDialogThemeSelectLightOption',
    icon: <IconLightOutline16 />,
  },
  {
    value: 'dark',
    label: 'avatarMenuSettingsDialogThemeSelectDarkOption',
    icon: <IconDarkOutline16 />,
  },
  {
    value: 'system',
    label: 'avatarMenuSettingsDialogThemeSelectSystemOption',
    icon: <IconFollowsystemOutline16 />,
  },
]

/**
 * 主题项：标题下方浅色 / 深色 / 跟随系统三个选块。
 * 与下方语言选项连续排列。
 */
const ThemeSetting = () => {
  const t = useTranslate()
  const themePreference = useSettings((state) => state.themePreference)
  const label = t('avatarMenuSettingsDialogThemeItemLabel')
  return (
    <div className={styles.theme}>
      {label}
      <div role="radiogroup" aria-label={label} className={styles.themeOptions}>
        {themeOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={themePreference === option.value}
            className={clsx(
              styles.themeOption,
              themePreference === option.value && styles.themeOptionSelected
            )}
            onClick={() => setThemePreference(option.value)}
          >
            {option.icon}
            {t(option.label)}
          </button>
        ))}
      </div>
    </div>
  )
}

/** `reason` 为失败原因的文案 key，展示时按当前语言翻译后填入 `message` 参数。 */
type Status = (TranslationMessage & { error?: boolean; reason?: TranslationKey }) | null

/** 导出失败附带原因：预期的错误用对应文案作原因，其他错误用错误信息。 */
const errorStatus = (key: TranslationKey, error: unknown): Status => ({
  key,
  ...(error instanceof BackupError
    ? { reason: error.key }
    : { params: { message: error instanceof Error ? error.message : String(error) } }),
  error: true,
})

const SettingCell = ({
  label,
  description,
  status,
  action,
  className,
}: {
  label: string
  description?: string
  status: Status
  action?: ReactNode
  className?: string
}) => {
  const t = useTranslate()
  return (
    <div className={clsx(styles.cell, styles.row, className)}>
      <div className={styles.text}>
        <div className={styles.label}>{label}</div>
        {status || description ? (
          <div className={clsx(styles.description, status?.error && styles.error)}>
            {status
              ? t(status.key, status.reason ? { message: t(status.reason) } : status.params)
              : description}
          </div>
        ) : null}
      </div>
      {action}
    </div>
  )
}

/** 选文件后直接增量导入为归档组；任何错误都提示导入失败及原因。 */
const useHistoryImport = () => {
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)
  const importing = useRef(false)

  const select = async (file: File) => {
    if (importing.current) {
      return
    }
    importing.current = true
    setBusy(true)
    setStatus(null)
    try {
      const [outcome] = await importArchiveFiles([file])
      if (outcome?.error) {
        throw outcome.error
      }
      const count = outcome?.sessions ?? 0
      setStatus({ key: count === 1 ? 'historyImportedOne' : 'historyImported', params: { count } })
    } catch (error) {
      setStatus(
        error instanceof BackupError
          ? { key: 'historyImportFailed', error: true, reason: error.key }
          : { key: 'historyImportFailed', error: true }
      )
    } finally {
      importing.current = false
      setBusy(false)
    }
  }

  return { busy, status, select }
}

/** 导入 = 新增归档组：选中的 ZIP 追加为一个新的会话组，不影响已有数据。 */
const ImportHistory = ({
  historyImport,
  disabled,
}: {
  historyImport: ReturnType<typeof useHistoryImport>
  disabled: boolean
}) => {
  const t = useTranslate()
  const inputRef = useRef<HTMLInputElement>(null)

  return (
    <SettingCell
      label={t('historyImport')}
      description={t('historyImportDescription')}
      status={historyImport.status}
      action={
        <>
          <Button
            variant="outlined"
            size="m"
            className={clsx(styles.cellButton, styles.uploadButton)}
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
          >
            <IconUploadOutline14 />
            {t('upload')}
          </Button>
          <input
            ref={inputRef}
            type="file"
            accept=".zip,.json"
            hidden
            onChange={(event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (file) {
                void historyImport.select(file)
              }
            }}
          />
        </>
      }
    />
  )
}

/** 将全部会话及图片导出为 ZIP 文件并下载 */
const ExportHistory = ({ disabled }: { disabled: boolean }) => {
  const t = useTranslate()
  const empty = useChatStore((state) => state.sessions.length === 0)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<Status>(null)

  const onExport = async () => {
    setBusy(true)
    setStatus(null)
    try {
      const { name, blob } = await exportHistory()
      const result = await saveBlob(name, blob)
      if (result === 'saved') {
        showToast({ key: 'exportSaved' })
      }
    } catch (error) {
      setStatus(errorStatus('historyExportFailed', error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <SettingCell
      label={t('exportAllLabel')}
      description={t('historyExportDescription')}
      status={status}
      action={
        <Button
          variant="outlined"
          size="m"
          className={styles.cellButton}
          disabled={disabled || busy || empty}
          onClick={() => void onExport()}
        >
          <IconDownloadOutline16 />
          {t('exportAllDownload')}
        </Button>
      }
    />
  )
}

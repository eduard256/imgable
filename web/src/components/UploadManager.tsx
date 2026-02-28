// ============================================================
// UploadManager — Drag & drop upload with toast progress
//
// Drop files anywhere on the gallery to upload.
// No visual drop zone — files are silently accepted.
// Toast pill at bottom shows progress: "Uploading 2/5 done"
// Click toast to expand detailed file list.
// Supports folder drag via webkitGetAsEntry.
// Parallel uploads (max 3) via XMLHttpRequest for progress.
// ============================================================

import { useState, useEffect, useRef, useCallback, useImperativeHandle, forwardRef } from 'react'
import { getToken } from '../lib/api'
import { t } from '../lib/i18n'

// ---- Types ----

type FileStatus = 'pending' | 'uploading' | 'done' | 'error' | 'cancelled'

interface UploadItem {
  id: number
  file: File
  status: FileStatus
  progress: number
  error: string | null
  xhr: XMLHttpRequest | null
}

// ---- Constants ----

const MAX_FILE_SIZE = 4 * 1024 * 1024 * 1024 // 4 GB
const MAX_PARALLEL = 3
const SUPPORTED_EXT = new Set([
  '.jpg', '.jpeg', '.png', '.gif', '.webp', '.heic', '.heif', '.tiff', '.tif', '.bmp',
  '.raw', '.cr2', '.cr3', '.arw', '.nef', '.dng', '.orf', '.rw2',
  '.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.mts', '.m2ts', '.3gp',
])

// ---- Helpers ----

function getExtension(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot).toLowerCase() : ''
}

function isValidFile(file: File): boolean {
  if (!file.name || file.name.startsWith('.')) return false
  return SUPPORTED_EXT.has(getExtension(file.name))
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`
}

// Recursively traverse a FileSystemEntry to collect all files
async function traverseEntry(entry: FileSystemEntry, files: File[]): Promise<void> {
  if (entry.isFile) {
    const fileEntry = entry as FileSystemFileEntry
    const file = await new Promise<File>((resolve, reject) => {
      fileEntry.file(resolve, reject)
    })
    files.push(file)
  } else if (entry.isDirectory) {
    const dirEntry = entry as FileSystemDirectoryEntry
    const reader = dirEntry.createReader()

    const readBatch = (): Promise<FileSystemEntry[]> =>
      new Promise((resolve, reject) => {
        reader.readEntries(resolve, reject)
      })

    let batch: FileSystemEntry[]
    do {
      batch = await readBatch()
      for (const child of batch) {
        await traverseEntry(child, files)
      }
    } while (batch.length > 0)
  }
}

// ---- Public handle ----

export interface UploadManagerHandle {
  addFiles: (files: File[]) => void
}

// ---- Component ----

const UploadManager = forwardRef<UploadManagerHandle, { containerRef: React.RefObject<HTMLDivElement | null> }>(function UploadManager({ containerRef }, ref) {
  const [items, setItems] = useState<UploadItem[]>([])
  const [expanded, setExpanded] = useState(false)

  const idCounterRef = useRef(0)
  const activeCountRef = useRef(0)
  const itemsRef = useRef<UploadItem[]>([])
  const cancelledRef = useRef(false)

  // Keep ref in sync with state
  useEffect(() => {
    itemsRef.current = items
  }, [items])

  // Process queue: start pending uploads up to MAX_PARALLEL
  const processQueue = useCallback(() => {
    if (cancelledRef.current) return

    while (activeCountRef.current < MAX_PARALLEL) {
      const next = itemsRef.current.find((f) => f.status === 'pending')
      if (!next) break
      startUpload(next)
    }
  }, [])

  // Start uploading a single file
  function startUpload(item: UploadItem) {
    item.status = 'uploading'
    item.progress = 0
    activeCountRef.current++
    updateItem(item)

    const xhr = new XMLHttpRequest()
    item.xhr = xhr

    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && item.status === 'uploading') {
        item.progress = Math.round((e.loaded / e.total) * 100)
        updateItem(item)
      }
    }

    xhr.onload = () => {
      item.xhr = null
      activeCountRef.current--

      if (xhr.status >= 200 && xhr.status < 300) {
        item.status = 'done'
        item.progress = 100
      } else {
        item.status = 'error'
        try {
          const resp = JSON.parse(xhr.responseText)
          item.error = resp.error || `Error ${xhr.status}`
        } catch {
          item.error = xhr.statusText || `Error ${xhr.status}`
        }
      }

      updateItem(item)
      processQueue()
    }

    xhr.onerror = () => {
      item.xhr = null
      activeCountRef.current--
      item.status = 'error'
      item.error = t('network_error')
      updateItem(item)
      processQueue()
    }

    xhr.onabort = () => {
      item.xhr = null
      if (item.status === 'uploading') {
        activeCountRef.current--
        item.status = 'cancelled'
        updateItem(item)
        processQueue()
      }
    }

    const formData = new FormData()
    formData.append('file', item.file)

    xhr.open('POST', '/api/v1/upload')
    const token = getToken()
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.send(formData)
  }

  // Update a single item in state (trigger re-render)
  function updateItem(item: UploadItem) {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...item } : i)))
  }

  // Process dropped/selected files
  const processFiles = useCallback(
    (files: File[]) => {
      const newItems: UploadItem[] = []

      for (const file of files) {
        if (!isValidFile(file)) continue
        if (file.size > MAX_FILE_SIZE) continue

        const id = ++idCounterRef.current
        newItems.push({
          id,
          file,
          status: 'pending',
          progress: 0,
          error: null,
          xhr: null,
        })
      }

      if (newItems.length === 0) return

      cancelledRef.current = false
      setItems((prev) => {
        const updated = [...prev, ...newItems]
        itemsRef.current = updated
        return updated
      })

      // Defer queue processing to next tick so state is updated
      setTimeout(() => processQueue(), 0)
    },
    [processQueue],
  )

  // Expose addFiles to parent via ref
  useImperativeHandle(ref, () => ({
    addFiles: (files: File[]) => processFiles(files),
  }), [processFiles])

  // Set up drag & drop on the container
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onDragOver = (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()
    }

    const onDrop = async (e: DragEvent) => {
      e.preventDefault()
      e.stopPropagation()

      const dataTransfer = e.dataTransfer
      if (!dataTransfer) return

      const collectedFiles: File[] = []
      const entries: FileSystemEntry[] = []

      // Collect entries for folder support
      if (dataTransfer.items) {
        for (let i = 0; i < dataTransfer.items.length; i++) {
          const item = dataTransfer.items[i]
          if (item.kind === 'file') {
            const entry = item.webkitGetAsEntry?.()
            if (entry) {
              entries.push(entry)
            } else {
              const file = item.getAsFile()
              if (file) collectedFiles.push(file)
            }
          }
        }
      }

      // Traverse folder entries recursively
      for (const entry of entries) {
        try {
          await traverseEntry(entry, collectedFiles)
        } catch {
          // Skip unreadable entries
        }
      }

      if (collectedFiles.length > 0) {
        processFiles(collectedFiles)
      }
    }

    el.addEventListener('dragover', onDragOver)
    el.addEventListener('drop', onDrop)

    return () => {
      el.removeEventListener('dragover', onDragOver)
      el.removeEventListener('drop', onDrop)
    }
  }, [containerRef, processFiles])

  // Cancel a single upload
  function cancelItem(id: number) {
    const item = itemsRef.current.find((i) => i.id === id)
    if (!item) return

    if (item.status === 'pending') {
      item.status = 'cancelled'
      updateItem(item)
    } else if (item.status === 'uploading' && item.xhr) {
      item.xhr.abort()
    }
  }

  // Cancel all
  function cancelAll() {
    cancelledRef.current = true
    for (const item of itemsRef.current) {
      if (item.status === 'pending') {
        item.status = 'cancelled'
      } else if (item.status === 'uploading' && item.xhr) {
        item.xhr.abort()
      }
    }
    setItems([...itemsRef.current])
  }

  // Clear completed/failed/cancelled
  function clearDone() {
    setItems((prev) => {
      const kept = prev.filter(
        (i) => i.status === 'pending' || i.status === 'uploading',
      )
      itemsRef.current = kept
      return kept
    })
  }

  // Computed stats
  const total = items.length
  const doneCount = items.filter((i) => i.status === 'done').length
  const activeCount = items.filter(
    (i) => i.status === 'uploading' || i.status === 'pending',
  ).length
  const errorCount = items.filter(
    (i) => i.status === 'error' || i.status === 'cancelled',
  ).length

  // Don't render anything if no uploads
  if (total === 0) return null

  // All done?
  const allFinished = activeCount === 0

  return (
    <div className="fixed z-40" style={{ bottom: '20px', left: '50%', transform: 'translateX(-50%)' }}>
      {/* Expanded panel */}
      {expanded && (
        <div
          style={{
            position: 'absolute',
            bottom: '52px',
            left: '50%',
            transform: 'translateX(-50%)',
            width: 'min(90vw, 380px)',
            maxHeight: '300px',
            overflowY: 'auto',
            background: 'rgba(25, 20, 16, 0.97)',
            borderRadius: '16px',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            padding: '12px',
            backdropFilter: 'blur(12px)',
            boxShadow: '0 8px 32px rgba(0, 0, 0, 0.4)',
          }}
        >
          {/* Action buttons */}
          <div className="flex gap-2 justify-end" style={{ marginBottom: '8px' }}>
            {activeCount > 0 && (
              <MiniButton label={t('cancel_all')} onClick={cancelAll} />
            )}
            {(doneCount > 0 || errorCount > 0) && (
              <MiniButton label={t('clear')} onClick={clearDone} />
            )}
          </div>

          {/* File list */}
          {items.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-3"
              style={{
                padding: '6px 0',
                borderBottom: '1px solid rgba(255, 255, 255, 0.04)',
              }}
            >
              {/* Filename */}
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  fontSize: '12px',
                  color: 'rgba(255, 255, 255, 0.7)',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {item.file.name}
              </div>

              {/* Size */}
              <span
                style={{
                  fontSize: '10px',
                  color: 'rgba(255, 255, 255, 0.3)',
                  flexShrink: 0,
                }}
              >
                {formatBytes(item.file.size)}
              </span>

              {/* Status / Progress */}
              <span
                style={{
                  fontSize: '11px',
                  flexShrink: 0,
                  minWidth: '48px',
                  textAlign: 'right',
                  color:
                    item.status === 'done'
                      ? '#6B8E5A'
                      : item.status === 'error'
                        ? '#CF5636'
                        : item.status === 'cancelled'
                          ? 'rgba(255,255,255,0.3)'
                          : 'rgba(255, 255, 255, 0.6)',
                }}
              >
                {item.status === 'uploading'
                  ? `${item.progress}%`
                  : item.status === 'done'
                    ? t('upload_done')
                    : item.status === 'error'
                      ? (item.error || t('upload_error'))
                      : item.status === 'cancelled'
                        ? t('upload_cancelled')
                        : t('waiting')}
              </span>

              {/* Cancel button — only for pending/uploading */}
              {(item.status === 'pending' || item.status === 'uploading') && (
                <button
                  onClick={() => cancelItem(item.id)}
                  style={{
                    width: '20px',
                    height: '20px',
                    borderRadius: '6px',
                    background: 'rgba(255, 255, 255, 0.06)',
                    border: 'none',
                    color: 'rgba(255, 255, 255, 0.4)',
                    fontSize: '12px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    padding: 0,
                  }}
                >
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <line x1="18" y1="6" x2="6" y2="18" />
                    <line x1="6" y1="6" x2="18" y2="18" />
                  </svg>
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Toast pill */}
      <button
        onClick={() => setExpanded((prev) => !prev)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '8px',
          padding: '8px 18px',
          borderRadius: '20px',
          background: allFinished
            ? 'rgba(107, 142, 90, 0.9)'
            : 'rgba(25, 20, 16, 0.95)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255, 255, 255, 0.1)',
          boxShadow: '0 4px 20px rgba(0, 0, 0, 0.3)',
          cursor: 'pointer',
          color: 'rgba(255, 255, 255, 0.9)',
          fontSize: '13px',
          fontWeight: 400,
          fontFamily: 'var(--font-sans)',
          whiteSpace: 'nowrap',
          transition: 'background 0.3s ease',
        }}
      >
        {/* Spinner or checkmark */}
        {activeCount > 0 ? (
          <div
            style={{
              width: '14px',
              height: '14px',
              border: '2px solid rgba(255, 255, 255, 0.2)',
              borderTopColor: 'rgba(255, 255, 255, 0.8)',
              borderRadius: '50%',
              animation: 'uploadSpin 0.8s linear infinite',
              flexShrink: 0,
            }}
          />
        ) : (
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        )}

        {/* Text */}
        {activeCount > 0 ? (
          <span>
            {t('uploading_files')} {doneCount}/{total}
          </span>
        ) : (
          <span>
            {t('upload_done')} {doneCount}/{total}
            {errorCount > 0 && (
              <span style={{ color: 'rgba(207, 86, 54, 0.9)', marginLeft: '6px' }}>
                {errorCount} {t('upload_error').toLowerCase()}
              </span>
            )}
          </span>
        )}

        {/* Expand indicator */}
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          style={{
            transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform 0.2s ease',
            opacity: 0.5,
          }}
        >
          <polyline points="18 15 12 9 6 15" />
        </svg>
      </button>
    </div>
  )
})

export default UploadManager

// Small action button for the expanded panel
function MiniButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '3px 10px',
        borderRadius: '8px',
        background: 'rgba(255, 255, 255, 0.06)',
        border: '1px solid rgba(255, 255, 255, 0.08)',
        color: 'rgba(255, 255, 255, 0.5)',
        fontSize: '11px',
        cursor: 'pointer',
        fontFamily: 'var(--font-sans)',
      }}
    >
      {label}
    </button>
  )
}

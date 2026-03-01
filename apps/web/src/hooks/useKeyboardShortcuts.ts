import { useEffect } from 'react';

export interface ShortcutHandlers {
  onOpenCommand: () => void;
  onNewDoc: () => void;
  onToggleSidebar: () => void;
  onToggleAI: () => void;
  onShowHelp: () => void;
}

/** Returns true when the event target is an editable element (input, textarea, contenteditable). */
function isEditableTarget(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (el.isContentEditable) return true;
  return false;
}

/**
 * Global keyboard shortcut handler.
 *
 * Registered shortcuts:
 *   ⌘K / Ctrl+K        → Command Palette
 *   ⌘N / Ctrl+N        → New Document
 *   ⌘/ / Ctrl+/        → Toggle Sidebar
 *   ⌘⇧A / Ctrl+⇧A     → Toggle AI Sheet
 *   ?                  → Show Keyboard Help  (only when not in editable field)
 */
export function useKeyboardShortcuts(handlers: ShortcutHandlers) {
  useEffect(() => {
    function handle(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;

      // ⌘K / Ctrl+K → Command Palette
      if (mod && e.key === 'k') {
        e.preventDefault();
        handlers.onOpenCommand();
        return;
      }

      // ⌘N / Ctrl+N → New Document
      if (mod && e.key === 'n') {
        e.preventDefault();
        handlers.onNewDoc();
        return;
      }

      // ⌘/ / Ctrl+/ → Toggle Sidebar
      if (mod && e.key === '/') {
        e.preventDefault();
        handlers.onToggleSidebar();
        return;
      }

      // ⌘⇧A / Ctrl+⇧A → Toggle AI Sheet
      if (mod && e.shiftKey && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        handlers.onToggleAI();
        return;
      }

      // ? → Show Keyboard Help (not in editable fields)
      if (e.key === '?' && !mod && !isEditableTarget(e)) {
        e.preventDefault();
        handlers.onShowHelp();
        return;
      }
    }

    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [handlers]);
}

/** Shortcut metadata for display in KeyboardHelpModal. */
export interface ShortcutDef {
  keys: string[];
  label: string;
  group: string;
}

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
const MOD = isMac ? '⌘' : 'Ctrl';

export const SHORTCUT_DEFS: ShortcutDef[] = [
  // 一般
  { group: '一般', keys: [`${MOD}K`],        label: '命令面板' },
  { group: '一般', keys: ['?'],               label: '顯示快捷鍵說明' },
  { group: '一般', keys: ['Esc'],             label: '關閉 / 取消' },

  // 文件
  { group: '文件', keys: [`${MOD}N`],         label: '新增文件' },
  { group: '文件', keys: [`${MOD}S`],         label: '儲存（自動）' },

  // 導航
  { group: '導航', keys: [`${MOD}/`],         label: '切換側邊欄' },
  { group: '導航', keys: [`${MOD}⇧A`],        label: '開啟 / 關閉 AI 助手' },
  { group: '導航', keys: ['↑ ↓'],             label: '命令面板導航' },
  { group: '導航', keys: ['↵'],               label: '確認選項' },
];

export const isMac = navigator.userAgent.includes('Mac');
/** Modifier prefix for shortcut labels: "⌘" on macOS, "Ctrl+" elsewhere. */
export const mod = isMac ? '⌘' : 'Ctrl+';

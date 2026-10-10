// Small stroke icons for the chrome (24-unit grid, currentColor).
const P = (d: string) => () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d={d} />
  </svg>
);

export const IconUndo = P('M9 14L4 9l5-5M4 9h10a6 6 0 010 12h-3');
export const IconRedo = P('M15 14l5-5-5-5M20 9H10a6 6 0 000 12h3');
export const IconPanelLeft = P('M4 5h16v14H4zM9 5v14');
export const IconPanelRight = P('M4 5h16v14H4zM15 5v14');
export const IconLayout = P('M4 5h6v5H4zM14 5h6v5h-6zM9 14h6v5H9zM7 10v2h10v-2M12 12v2');
export const IconExport = P('M12 3v12M7 10l5 5 5-5M5 21h14');
export const IconSparkle = P(
  'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.7 2 2 .7-2 .7-.7 2-.7-2-2-.7 2-.7z',
);
export const IconSettings = P(
  'M12 15a3 3 0 100-6 3 3 0 000 6zM19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z',
);
export const IconClose = P('M6 6l12 12M18 6L6 18');
export const IconTrash = P('M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13');
export const IconMoon = P('M21 12.8A9 9 0 1111.2 3a7 7 0 009.8 9.8z');
export const IconSun = P(
  'M12 16a4 4 0 100-8 4 4 0 000 8zM12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4',
);
export const IconPlus = P('M12 5v14M5 12h14');
export const IconMinus = P('M5 12h14');
export const IconRefresh = P('M20 11a8 8 0 10-2.3 5.7M20 4v7h-7');
export const IconChevron = P('M6 9l6 6 6-6');
export const IconTerminal = P('M5 7l5 5-5 5M12 18h7');
export const IconCheck = P('M5 12.5l4.5 4.5L19 7.5');

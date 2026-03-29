// ── Theme System ─────────────────────────────────────────────────────────────

export interface ThemeVars {
  background: string; foreground: string;
  card: string; cardForeground: string;
  primary: string; primaryForeground: string;
  secondary: string; secondaryForeground: string;
  muted: string; mutedForeground: string;
  accent: string; accentForeground: string;
  border: string; input: string; ring: string;
  sidebar: string; sidebarForeground: string;
  sidebarPrimary: string; sidebarPrimaryForeground: string;
  sidebarAccent: string; sidebarAccentForeground: string;
  sidebarBorder: string;
  destructive: string; destructiveForeground: string;
}

export interface PresetTheme {
  id: string;
  name: string;
  type: 'light' | 'dark';
  preview: { bg: string; card: string; primary: string; accent2: string };
  vars: ThemeVars;
  custom?: false;
}

export interface CustomTheme {
  id: string;
  name: string;
  type: 'light' | 'dark';
  primaryHex: string;
  preview: { bg: string; card: string; primary: string; accent2: string };
  custom: true;
  vars: ThemeVars;
}

export type Theme = PresetTheme | CustomTheme;

// ── Preset definitions ────────────────────────────────────────────────────────

const PRESETS: PresetTheme[] = [
  {
    id: 'arctic-white',
    name: 'Arctic White',
    type: 'light',
    preview: { bg: '#f4f6f8', card: '#ffffff', primary: '#1345bf', accent2: '#64748b' },
    vars: {
      background: '210 20% 97%', foreground: '222 47% 8%',
      card: '0 0% 100%', cardForeground: '222 47% 8%',
      primary: '221 83% 40%', primaryForeground: '0 0% 100%',
      secondary: '210 20% 93%', secondaryForeground: '222 47% 15%',
      muted: '210 20% 93%', mutedForeground: '215 20% 48%',
      accent: '221 83% 40%', accentForeground: '0 0% 100%',
      destructive: '0 72% 51%', destructiveForeground: '0 0% 100%',
      border: '214 24% 88%', input: '214 24% 93%', ring: '221 83% 40%',
      sidebar: '210 33% 97%', sidebarForeground: '222 47% 8%',
      sidebarPrimary: '221 83% 40%', sidebarPrimaryForeground: '0 0% 100%',
      sidebarAccent: '210 20% 91%', sidebarAccentForeground: '222 47% 8%',
      sidebarBorder: '214 24% 87%',
    },
  },
  {
    id: 'midnight-pro',
    name: 'Midnight Pro',
    type: 'dark',
    preview: { bg: '#0f172a', card: '#1e293b', primary: '#0ea5e9', accent2: '#94a3b8' },
    vars: {
      background: '222 47% 8%', foreground: '210 40% 98%',
      card: '222 47% 12%', cardForeground: '210 40% 98%',
      primary: '199 89% 48%', primaryForeground: '222 47% 8%',
      secondary: '217 33% 17%', secondaryForeground: '210 40% 98%',
      muted: '217 33% 17%', mutedForeground: '215 20% 65%',
      accent: '199 89% 48%', accentForeground: '222 47% 8%',
      destructive: '0 84% 60%', destructiveForeground: '210 40% 98%',
      border: '217 33% 22%', input: '217 33% 17%', ring: '199 89% 48%',
      sidebar: '222 47% 7%', sidebarForeground: '210 40% 98%',
      sidebarPrimary: '199 89% 48%', sidebarPrimaryForeground: '222 47% 8%',
      sidebarAccent: '217 33% 17%', sidebarAccentForeground: '210 40% 98%',
      sidebarBorder: '217 33% 18%',
    },
  },
  {
    id: 'ocean-dark',
    name: 'Ocean Dark',
    type: 'dark',
    preview: { bg: '#070d1e', card: '#0e1a30', primary: '#14b8a6', accent2: '#7dd3fc' },
    vars: {
      background: '220 55% 7%', foreground: '200 30% 97%',
      card: '220 50% 11%', cardForeground: '200 30% 97%',
      primary: '173 80% 40%', primaryForeground: '220 55% 7%',
      secondary: '220 40% 16%', secondaryForeground: '200 30% 97%',
      muted: '220 40% 16%', mutedForeground: '220 20% 60%',
      accent: '173 80% 40%', accentForeground: '220 55% 7%',
      destructive: '0 72% 55%', destructiveForeground: '0 0% 100%',
      border: '220 40% 19%', input: '220 40% 16%', ring: '173 80% 40%',
      sidebar: '220 55% 6%', sidebarForeground: '200 30% 97%',
      sidebarPrimary: '173 80% 40%', sidebarPrimaryForeground: '220 55% 7%',
      sidebarAccent: '220 40% 15%', sidebarAccentForeground: '200 30% 97%',
      sidebarBorder: '220 40% 17%',
    },
  },
  {
    id: 'emerald-night',
    name: 'Emerald Night',
    type: 'dark',
    preview: { bg: '#0a1208', card: '#101f13', primary: '#10b981', accent2: '#6ee7b7' },
    vars: {
      background: '150 35% 6%', foreground: '140 15% 97%',
      card: '150 30% 9%', cardForeground: '140 15% 97%',
      primary: '160 84% 39%', primaryForeground: '150 35% 6%',
      secondary: '150 25% 14%', secondaryForeground: '140 15% 97%',
      muted: '150 25% 14%', mutedForeground: '150 15% 60%',
      accent: '160 84% 39%', accentForeground: '150 35% 6%',
      destructive: '0 72% 55%', destructiveForeground: '0 0% 100%',
      border: '150 20% 16%', input: '150 25% 14%', ring: '160 84% 39%',
      sidebar: '150 35% 5%', sidebarForeground: '140 15% 97%',
      sidebarPrimary: '160 84% 39%', sidebarPrimaryForeground: '150 35% 6%',
      sidebarAccent: '150 25% 13%', sidebarAccentForeground: '140 15% 97%',
      sidebarBorder: '150 20% 14%',
    },
  },
  {
    id: 'warm-amber',
    name: 'Warm Amber',
    type: 'dark',
    preview: { bg: '#160f08', card: '#211710', primary: '#f59e0b', accent2: '#fcd34d' },
    vars: {
      background: '25 30% 7%', foreground: '35 20% 97%',
      card: '25 25% 11%', cardForeground: '35 20% 97%',
      primary: '38 92% 50%', primaryForeground: '25 30% 7%',
      secondary: '25 20% 17%', secondaryForeground: '35 20% 97%',
      muted: '25 20% 17%', mutedForeground: '30 15% 62%',
      accent: '38 92% 50%', accentForeground: '25 30% 7%',
      destructive: '0 72% 55%', destructiveForeground: '0 0% 100%',
      border: '25 20% 20%', input: '25 20% 17%', ring: '38 92% 50%',
      sidebar: '25 30% 6%', sidebarForeground: '35 20% 97%',
      sidebarPrimary: '38 92% 50%', sidebarPrimaryForeground: '25 30% 7%',
      sidebarAccent: '25 20% 16%', sidebarAccentForeground: '35 20% 97%',
      sidebarBorder: '25 20% 17%',
    },
  },
  {
    id: 'rose-quartz',
    name: 'Rose Quartz',
    type: 'light',
    preview: { bg: '#fdf1f3', card: '#ffffff', primary: '#e11d48', accent2: '#9f1239' },
    vars: {
      background: '350 60% 97%', foreground: '345 40% 8%',
      card: '0 0% 100%', cardForeground: '345 40% 8%',
      primary: '346 77% 49%', primaryForeground: '0 0% 100%',
      secondary: '350 30% 93%', secondaryForeground: '345 40% 15%',
      muted: '350 30% 93%', mutedForeground: '350 15% 48%',
      accent: '346 77% 49%', accentForeground: '0 0% 100%',
      destructive: '0 84% 60%', destructiveForeground: '0 0% 100%',
      border: '350 25% 87%', input: '350 25% 92%', ring: '346 77% 49%',
      sidebar: '350 40% 97%', sidebarForeground: '345 40% 8%',
      sidebarPrimary: '346 77% 49%', sidebarPrimaryForeground: '0 0% 100%',
      sidebarAccent: '350 30% 91%', sidebarAccentForeground: '345 40% 8%',
      sidebarBorder: '350 25% 86%',
    },
  },
  {
    id: 'violet-pro',
    name: 'Violet Pro',
    type: 'dark',
    preview: { bg: '#0e0a18', card: '#16112a', primary: '#a855f7', accent2: '#d8b4fe' },
    vars: {
      background: '260 30% 7%', foreground: '260 15% 97%',
      card: '260 25% 11%', cardForeground: '260 15% 97%',
      primary: '270 95% 64%', primaryForeground: '260 30% 7%',
      secondary: '260 20% 17%', secondaryForeground: '260 15% 97%',
      muted: '260 20% 17%', mutedForeground: '260 15% 62%',
      accent: '270 95% 64%', accentForeground: '260 30% 7%',
      destructive: '0 72% 55%', destructiveForeground: '0 0% 100%',
      border: '260 20% 20%', input: '260 20% 17%', ring: '270 95% 64%',
      sidebar: '260 30% 6%', sidebarForeground: '260 15% 97%',
      sidebarPrimary: '270 95% 64%', sidebarPrimaryForeground: '260 30% 7%',
      sidebarAccent: '260 20% 16%', sidebarAccentForeground: '260 15% 97%',
      sidebarBorder: '260 20% 17%',
    },
  },
];

export const PRESET_THEMES = PRESETS;

// ── Custom theme accents ──────────────────────────────────────────────────────

export const ACCENT_PRESETS = [
  { hex: '#1345bf', label: 'Navy Blue' },
  { hex: '#0ea5e9', label: 'Sky Cyan' },
  { hex: '#14b8a6', label: 'Teal' },
  { hex: '#10b981', label: 'Emerald' },
  { hex: '#22c55e', label: 'Green' },
  { hex: '#f59e0b', label: 'Amber' },
  { hex: '#f97316', label: 'Orange' },
  { hex: '#ef4444', label: 'Red' },
  { hex: '#e11d48', label: 'Rose' },
  { hex: '#ec4899', label: 'Pink' },
  { hex: '#a855f7', label: 'Violet' },
  { hex: '#6366f1', label: 'Indigo' },
];

// ── Utilities ─────────────────────────────────────────────────────────────────

/** Convert hex to HSL string "H S% L%" */
export function hexToHsl(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
      case g: h = ((b - r) / d + 2) / 6; break;
      case b: h = ((r - g) / d + 4) / 6; break;
    }
  }
  return `${Math.round(h * 360)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`;
}

/** Build a full ThemeVars from a primary hex + light/dark base */
export function buildCustomVars(primaryHex: string, type: 'light' | 'dark'): ThemeVars {
  const hsl = hexToHsl(primaryHex);
  const base = type === 'light' ? PRESETS[0].vars : PRESETS[1].vars; // arctic-white or midnight-pro
  return {
    ...base,
    primary: hsl,
    primaryForeground: type === 'light' ? '0 0% 100%' : base.background,
    accent: hsl,
    accentForeground: type === 'light' ? '0 0% 100%' : base.background,
    ring: hsl,
    sidebarPrimary: hsl,
    sidebarPrimaryForeground: type === 'light' ? '0 0% 100%' : base.background,
  };
}

// ── Storage keys ──────────────────────────────────────────────────────────────
const ACTIVE_KEY = 'winm-theme-id';
const CUSTOM_KEY = 'winm-custom-themes';

export function getActiveThemeId(): string {
  return localStorage.getItem(ACTIVE_KEY) ?? 'arctic-white';
}

export function setActiveThemeId(id: string) {
  localStorage.setItem(ACTIVE_KEY, id);
}

export function getCustomThemes(): CustomTheme[] {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? '[]');
  } catch { return []; }
}

export function saveCustomTheme(t: CustomTheme) {
  const existing = getCustomThemes().filter(x => x.id !== t.id);
  localStorage.setItem(CUSTOM_KEY, JSON.stringify([...existing, t]));
}

export function deleteCustomTheme(id: string) {
  localStorage.setItem(CUSTOM_KEY, JSON.stringify(getCustomThemes().filter(x => x.id !== id)));
}

export function getAllThemes(): Theme[] {
  return [...PRESET_THEMES, ...getCustomThemes()];
}

// ── Apply theme to document ───────────────────────────────────────────────────

const VAR_MAP: Record<keyof ThemeVars, string> = {
  background: '--background', foreground: '--foreground',
  card: '--card', cardForeground: '--card-foreground',
  primary: '--primary', primaryForeground: '--primary-foreground',
  secondary: '--secondary', secondaryForeground: '--secondary-foreground',
  muted: '--muted', mutedForeground: '--muted-foreground',
  accent: '--accent', accentForeground: '--accent-foreground',
  destructive: '--destructive', destructiveForeground: '--destructive-foreground',
  border: '--border', input: '--input', ring: '--ring',
  sidebar: '--sidebar', sidebarForeground: '--sidebar-foreground',
  sidebarPrimary: '--sidebar-primary', sidebarPrimaryForeground: '--sidebar-primary-foreground',
  sidebarAccent: '--sidebar-accent', sidebarAccentForeground: '--sidebar-accent-foreground',
  sidebarBorder: '--sidebar-border',
};

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.setAttribute('data-theme', theme.id);
  // Apply all vars directly so custom themes work without pre-defined CSS selectors
  for (const [key, cssVar] of Object.entries(VAR_MAP)) {
    const val = theme.vars[key as keyof ThemeVars];
    if (val) root.style.setProperty(cssVar, val);
  }
  setActiveThemeId(theme.id);
}

export function applyThemeById(id: string) {
  const theme = getAllThemes().find(t => t.id === id);
  if (theme) applyTheme(theme);
}

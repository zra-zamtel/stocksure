import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import en from './en.json';
import ny from './ny.json';

export type Language = 'en' | 'ny';

const bundles: Record<Language, Record<string, string>> = { en, ny };

type Vars = Record<string, string | number>;

type I18nValue = {
  language: Language;
  setLanguage: (language: Language) => void;
  t: (key: string, vars?: Vars) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

export const LANGUAGE_LABELS: Record<Language, string> = {
  en: 'English',
  ny: 'Nyanja',
};

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>('en');

  const t = useCallback(
    (key: string, vars?: Vars) => {
      const raw = bundles[language][key] ?? bundles.en[key] ?? key;
      if (!vars) return raw;
      return raw.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
    },
    [language]
  );

  const value = useMemo(() => ({ language, setLanguage, t }), [language, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}

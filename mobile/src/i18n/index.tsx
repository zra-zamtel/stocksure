import Storage from 'expo-sqlite/kv-store';
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import en from './en.json';
import ny from './ny.json';

export type Language = 'en' | 'ny';

const bundles: Record<Language, Record<string, string>> = { en, ny };
const LANGUAGE_KEY = 'stocksure.language';

/**
 * The language is chosen before an account or shop exists, so it cannot live in
 * the shop row yet. The key-value store keeps the choice across restarts; the
 * shop row records it once setup reaches the shop step.
 */
function readStoredLanguage(): Language {
  try {
    return Storage.getItemSync(LANGUAGE_KEY) === 'ny' ? 'ny' : 'en';
  } catch {
    return 'en';
  }
}

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
  const [language, setLanguageState] = useState<Language>(readStoredLanguage);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    try {
      Storage.setItemSync(LANGUAGE_KEY, next);
    } catch {
      // A storage failure must not block the language switch on screen.
    }
  }, []);

  const t = useCallback(
    (key: string, vars?: Vars) => {
      const raw = bundles[language][key] ?? bundles.en[key] ?? key;
      if (!vars) return raw;
      return raw.replace(/\{(\w+)\}/g, (_, name: string) => String(vars[name] ?? `{${name}}`));
    },
    [language]
  );

  const value = useMemo(() => ({ language, setLanguage, t }), [language, setLanguage, t]);
  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nValue {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside I18nProvider');
  return value;
}

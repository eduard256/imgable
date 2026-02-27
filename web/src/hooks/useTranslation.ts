import { useCallback } from 'react'
import { useAppStore } from '../utils/store'
import ru from '../locales/ru.json'
import en from '../locales/en.json'

const locales: Record<string, Record<string, string>> = { ru, en }

/**
 * Lightweight i18n hook. Returns translation function and current locale.
 * Translations are plain JSON files in /locales, keyed by short string IDs.
 * To add a language: create a new JSON file and add it to the locales map above.
 */
export function useTranslation() {
  const locale = useAppStore((s) => s.locale)

  const t = useCallback(
    (key: string, fallback?: string): string => {
      return locales[locale]?.[key] ?? locales['en']?.[key] ?? fallback ?? key
    },
    [locale],
  )

  return { t, locale }
}

import { createContext, useContext } from 'react'
import ru from '../locales/ru.json'
import en from '../locales/en.json'

type TranslationKey = keyof typeof ru

const locales: Record<string, Record<string, string>> = { ru, en }

// Detect browser language, default to Russian
function detectLanguage(): string {
  const saved = localStorage.getItem('imgable_lang')
  if (saved && locales[saved]) return saved
  const browser = navigator.language.slice(0, 2)
  return locales[browser] ? browser : 'ru'
}

let currentLang = detectLanguage()

export function t(key: TranslationKey): string {
  return locales[currentLang]?.[key] ?? locales['ru'][key] ?? key
}

export function getLang(): string {
  return currentLang
}

export function setLang(lang: string): void {
  if (locales[lang]) {
    currentLang = lang
    localStorage.setItem('imgable_lang', lang)
  }
}

export const I18nContext = createContext({ lang: currentLang, setLang, t })

export function useTranslation() {
  return useContext(I18nContext)
}

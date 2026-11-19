import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import ar from '../locales/ar'
import en from '../locales/en'

const KEY = 'espf.lang'

function initialLang(): 'en' | 'ar' {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'en' || saved === 'ar') return saved
  } catch { /* storage blocked */ }
  return navigator.language?.startsWith('ar') ? 'ar' : 'en'
}

export function applyDirection(lang: string) {
  document.documentElement.lang = lang
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr'
}

export function setLanguage(lang: 'en' | 'ar') {
  try { localStorage.setItem(KEY, lang) } catch { /* ignore */ }
  void i18n.changeLanguage(lang)
  applyDirection(lang)
}

void i18n.use(initReactI18next).init({
  resources: { en: { translation: en }, ar: { translation: ar } },
  lng: initialLang(),
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
})
applyDirection(i18n.language)

export default i18n

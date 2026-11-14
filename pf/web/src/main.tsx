import '@mantine/core/styles.css'
import '@mantine/notifications/styles.css'
import './print.css'
import { DirectionProvider, MantineProvider } from '@mantine/core'
import { Notifications } from '@mantine/notifications'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { useTranslation } from 'react-i18next'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './auth/AuthProvider'
import './lib/i18n'
import { theme } from './lib/theme'

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000, retry: 1 } } })

function Root() {
  const { i18n } = useTranslation()
  const dir = i18n.language === 'ar' ? 'rtl' : 'ltr'
  useEffect(() => { document.documentElement.dir = dir }, [dir])
  return (
    <DirectionProvider initialDirection={dir} detectDirection>
      <MantineProvider theme={theme} defaultColorScheme="light">
        <Notifications position="top-center" />
        <QueryClientProvider client={queryClient}>
          <BrowserRouter>
            <AuthProvider>
              <App />
            </AuthProvider>
          </BrowserRouter>
        </QueryClientProvider>
      </MantineProvider>
    </DirectionProvider>
  )
}

createRoot(document.getElementById('root')!).render(<StrictMode><Root /></StrictMode>)

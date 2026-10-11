import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.environmsafe.records',
  appName: 'EnvironmSafe Records',
  webDir: 'dist',
  server: { androidScheme: 'https' },
  android: { allowMixedContent: false, captureInput: true, webContentsDebuggingEnabled: false },
  plugins: {
    SplashScreen: { launchShowDuration: 800, backgroundColor: '#1B1B3A' },
  },
};

export default config;

// Android (Capacitor) features with browser fallbacks.

import { Capacitor } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();
export const APP_VERSION: string = __APP_VERSION__;
export const PUBLIC_URL: string = (import.meta.env.VITE_PUBLIC_URL as string | undefined) ?? '';

/** Takes a photo with the camera (Android) or returns null to fall back to the file picker. */
export async function takePhotoNative(source: 'camera' | 'gallery'): Promise<Blob | null> {
  if (!isNative) return null;
  const { Camera, CameraResultType, CameraSource } = await import('@capacitor/camera');
  const photo = await Camera.getPhoto({
    quality: 85,
    resultType: CameraResultType.Uri,
    source: source === 'camera' ? CameraSource.Camera : CameraSource.Photos,
    width: 1600,
    correctOrientation: true,
    saveToGallery: false,
  });
  if (!photo.webPath) return null;
  const res = await fetch(photo.webPath);
  return await res.blob();
}

/** Opens the Android share sheet, or downloads the file in a browser. */
export async function shareOrDownload(blob: Blob, fileName: string): Promise<void> {
  if (isNative) {
    const { Filesystem, Directory } = await import('@capacitor/filesystem');
    const { Share } = await import('@capacitor/share');
    const { blobToDataUrl } = await import('./files');
    const data = (await blobToDataUrl(blob)).split(',')[1];
    const written = await Filesystem.writeFile({ path: fileName, data, directory: Directory.Cache });
    await Share.share({ title: fileName, url: written.uri, dialogTitle: 'Share or open' });
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export async function biometricAvailable(): Promise<boolean> {
  if (!isNative) return false;
  try {
    const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
    const r = await BiometricAuth.checkBiometry();
    return r.isAvailable;
  } catch {
    return false;
  }
}

export async function biometricUnlock(): Promise<boolean> {
  try {
    const { BiometricAuth } = await import('@aparajita/capacitor-biometric-auth');
    await BiometricAuth.authenticate({
      reason: 'Unlock EnvironmSafe Records',
      cancelTitle: 'Use PIN',
      allowDeviceCredential: true,
      androidTitle: 'EnvironmSafe Records',
      androidSubtitle: 'Unlock to continue',
    });
    return true;
  } catch {
    return false;
  }
}

export interface VersionInfo {
  version: string;
  versionCode: number;
  apk: string;
  sha256?: string;
  size?: number;
  notes?: string;
}

export function versionCode(v: string): number {
  const [a = 0, b = 0, c = 0] = v.split('.').map((x) => parseInt(x, 10) || 0);
  return a * 10000 + b * 100 + c;
}

/** Checks the published version.json; returns info when a newer APK exists. */
export async function checkForUpdate(): Promise<VersionInfo | null> {
  if (!isNative || !PUBLIC_URL || !navigator.onLine) return null;
  try {
    const res = await fetch(`${PUBLIC_URL}/version.json`, { cache: 'no-store' });
    if (!res.ok) return null;
    const info = (await res.json()) as VersionInfo;
    return info.versionCode > versionCode(APP_VERSION) ? info : null;
  } catch {
    return null;
  }
}

export async function openExternal(url: string): Promise<void> {
  window.open(url, '_blank', 'noopener');
}

export async function onAppResume(fn: () => void): Promise<void> {
  if (!isNative) return;
  const { App } = await import('@capacitor/app');
  await App.addListener('resume', fn);
}

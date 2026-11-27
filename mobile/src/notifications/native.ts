import * as Notifications from 'expo-notifications';
import { AndroidImportance } from 'expo-notifications';
import { Linking, Platform } from 'react-native';
import { TAX_REMINDER_PREFIX } from '@/core';

/**
 * The one place that talks to expo-notifications. Local notifications only:
 * nothing here registers for push or sends a token anywhere. On the web every
 * call is a quiet no-op, so the web build keeps loading.
 */

export const supported = Platform.OS === 'android' || Platform.OS === 'ios';

export const CHANNEL_STOCK = 'stock';
export const CHANNEL_TAX = 'tax';

export type PermissionState = 'granted' | 'undetermined' | 'denied' | 'blocked' | 'unsupported';

if (supported) {
  // Show alerts as a banner even while the app is open: a low-stock alert
  // arrives right after a sale, with the app in the owner's hand.
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

let channelsReady: Promise<void> | null = null;

/**
 * Android 13 shows the permission dialog only once a channel exists, so this
 * runs before any request. Names are fixed English: the phone's own settings
 * list them, and they are set once.
 */
export function ensureChannels(): Promise<void> {
  if (Platform.OS !== 'android') return Promise.resolve();
  channelsReady ??= (async () => {
    try {
      await Notifications.setNotificationChannelAsync(CHANNEL_STOCK, {
        name: 'Low stock',
        description: 'When something you sell is running out',
        importance: AndroidImportance.HIGH,
      });
      await Notifications.setNotificationChannelAsync(CHANNEL_TAX, {
        name: 'Tax reminders',
        description: 'Before the ZRA turnover tax due date',
        importance: AndroidImportance.HIGH,
      });
    } catch {
      channelsReady = null;
    }
  })();
  return channelsReady;
}

function toState(response: Notifications.NotificationPermissionsStatus): PermissionState {
  if (response.granted) return 'granted';
  if (response.status === 'undetermined') return 'undetermined';
  // Once the phone stops asking, only its settings can turn alerts back on.
  return response.canAskAgain ? 'denied' : 'blocked';
}

export async function permissionState(): Promise<PermissionState> {
  if (!supported) return 'unsupported';
  try {
    return toState(await Notifications.getPermissionsAsync());
  } catch {
    return 'unsupported';
  }
}

export async function requestPermission(): Promise<PermissionState> {
  if (!supported) return 'unsupported';
  try {
    await ensureChannels();
    return toState(
      await Notifications.requestPermissionsAsync({
        ios: { allowAlert: true, allowSound: true, allowBadge: false },
      })
    );
  } catch {
    return permissionState();
  }
}

export function openPhoneSettings(): void {
  void Linking.openSettings().catch(() => undefined);
}

type Content = { title: string; body: string; url: string };

/** Shows a notification now. Returns false when the phone would not show it. */
export async function presentNow(content: Content, channelId = CHANNEL_STOCK): Promise<boolean> {
  if (!supported) return false;
  try {
    await ensureChannels();
    await Notifications.scheduleNotificationAsync({
      content: { title: content.title, body: content.body, data: { url: content.url } },
      trigger: Platform.OS === 'android' ? { channelId } : null,
    });
    return true;
  } catch {
    return false;
  }
}

export async function scheduleAt(id: string, at: Date, content: Content, channelId = CHANNEL_TAX): Promise<void> {
  if (!supported) return;
  await ensureChannels();
  await Notifications.scheduleNotificationAsync({
    identifier: id,
    content: { title: content.title, body: content.body, data: { url: content.url } },
    trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId },
  });
}

/** Cancels every scheduled tax reminder; delivered ones stay in the tray. */
export async function cancelTaxReminders(): Promise<void> {
  if (!supported) return;
  try {
    const scheduled = await Notifications.getAllScheduledNotificationsAsync();
    await Promise.all(
      scheduled
        .filter((request) => request.identifier.startsWith(TAX_REMINDER_PREFIX))
        .map((request) => Notifications.cancelScheduledNotificationAsync(request.identifier))
    );
  } catch {
    // Nothing scheduled, or the phone refused: either way nothing to undo.
  }
}

// The launch tap can arrive both from getLastNotificationResponse and the
// listener; remembering the last one handled stops a double navigation.
let lastHandled = '';

function urlOf(response: Notifications.NotificationResponse | null): string | null {
  if (!response || response.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return null;
  const key = `${response.notification.request.identifier}@${response.notification.date}`;
  if (key === lastHandled) return null;
  const url = response.notification.request.content.data?.url;
  if (typeof url !== 'string' || !url.startsWith('/')) return null;
  lastHandled = key;
  return url;
}

let launchUrl: string | null | undefined;

/** The tap that opened the app from closed, if any. Read from the phone once. */
export function takeLaunchUrl(): string | null {
  if (launchUrl !== undefined) return launchUrl;
  launchUrl = null;
  if (!supported) return null;
  try {
    launchUrl = urlOf(Notifications.getLastNotificationResponse());
    Notifications.clearLastNotificationResponse();
  } catch {
    // No launch tap to follow.
  }
  return launchUrl;
}

/** Taps while the app is running or in the background. */
export function onTap(listener: (url: string) => void): () => void {
  if (!supported) return () => undefined;
  const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
    const url = urlOf(response);
    if (url) listener(url);
  });
  return () => subscription.remove();
}

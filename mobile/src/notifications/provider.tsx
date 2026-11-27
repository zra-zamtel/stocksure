import { router, type Href } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';
import { useAuth } from '@/auth/session';
import {
  canAccessScreen,
  estimateTurnoverTax,
  forgetRestocked,
  lowStockMessage,
  planLowStock,
  potStatus,
  taxReminderMessage,
  taxReminderSlots,
} from '@/core';
import { taxRules } from '@/data/fake';
import { lowStockVariants, taxSnapshot } from '@/db/repos';
import { useI18n } from '@/i18n';
import { formatDay, formatKwacha } from '@/lib/format';
import {
  cancelTaxReminders,
  ensureChannels,
  onTap,
  openPhoneSettings,
  permissionState,
  presentNow,
  requestPermission,
  scheduleAt,
  supported,
  takeLaunchUrl,
  type PermissionState,
} from './native';
import {
  readLowStockTold,
  readPrefs,
  readPromptDone,
  storeLowStockTold,
  storePrefs,
  storePromptDone,
  type NotificationPrefs,
} from './store';

type NotificationsValue = {
  supported: boolean;
  permission: PermissionState;
  prefs: NotificationPrefs;
  setPref: (key: keyof NotificationPrefs, on: boolean) => void;
  /** The one-time Home card: shown until the owner answers it once. */
  promptVisible: boolean;
  /** Asks the phone for permission and hides the card, whatever the answer. */
  turnOn: () => Promise<PermissionState>;
  dismissPrompt: () => void;
  openSettings: () => void;
  /** Call after a sale is saved: low-stock alert now, tax reminders refreshed. */
  afterSale: () => void;
  /** Call after a restock: lets a restocked item be announced again later. */
  afterRestock: () => void;
  /** Call after a TaxPot top-up or payment. */
  afterTaxChange: () => void;
  /** For QA and demos. False when the phone would not show it. */
  sendTest: () => Promise<boolean>;
};

const NotificationsContext = createContext<NotificationsValue | null>(null);

/**
 * Phone notifications, all local. Low-stock alerts are shown right after a
 * sale; tax reminders are scheduled ahead with the phone's alarm clock, so they
 * fire with the app closed. Everything is recomputed from the database on
 * launch, on return to the app, and after anything that changes the figures.
 */
export function NotificationsProvider({ children }: { children: ReactNode }) {
  const db = useSQLiteContext();
  const { t, language } = useI18n();
  const { user, onboardingComplete, can } = useAuth();
  const [permission, setPermission] = useState<PermissionState>(supported ? 'undetermined' : 'unsupported');
  // The Home card waits for the real answer, so it never flashes for a phone that already allowed alerts.
  const [checked, setChecked] = useState(false);
  const [prefs, setPrefs] = useState<NotificationPrefs>(readPrefs);
  const [promptDone, setPromptDone] = useState(readPromptDone);
  const [pendingUrl, setPendingUrl] = useState<string | null>(takeLaunchUrl);

  const signedIn = user !== null;
  const ready = signedIn && onboardingComplete;
  const seesTax = ready && can('tax.view');
  const role = user?.role;

  // Read through refs so the after* calls stay stable for screens' callbacks.
  const live = useRef({ t, prefs, permission, seesTax, ready });
  useEffect(() => {
    live.current = { t, prefs, permission, seesTax, ready };
  });

  const refreshPermission = useCallback(async () => {
    setPermission(await permissionState());
    setChecked(true);
  }, []);

  // Every native change runs one after another, so a fast sale and a top-up
  // cannot interleave a cancel with a schedule.
  const queue = useRef<Promise<void>>(Promise.resolve());
  const enqueue = useCallback((job: () => Promise<void>) => {
    queue.current = queue.current.then(job).catch(() => undefined);
    return queue.current;
  }, []);

  const rescheduleTax = useCallback(
    () =>
      enqueue(async () => {
        const { t: translate, prefs: current, permission: allowed, seesTax: canSee } = live.current;
        // Locked after a cold start: keep what the owner's last session
        // scheduled. Only signing out cancels it (see below).
        if (!canSee) return;
        await cancelTaxReminders();
        if (!current.tax || allowed !== 'granted') return;
        const snapshot = await taxSnapshot(db);
        if (!snapshot.period) return;
        const estimate = estimateTurnoverTax(snapshot.turnover, taxRules, snapshot.yearToDate);
        const pot = potStatus(estimate.estimatedTax, snapshot.potBalance);
        const short = !estimate.incomeTax && pot.state === 'short';
        const slots = taxReminderSlots({
          dueOn: snapshot.period.dueOn,
          daysBefore: taxRules.reminderDaysBefore,
          now: new Date(),
          short,
        });
        const facts = {
          dueDay: formatDay(snapshot.period.dueOn),
          estimate: formatKwacha(estimate.estimatedTax),
          pot: formatKwacha(snapshot.potBalance),
          shortBy: formatKwacha(Math.max(0, pot.difference)),
          short,
          incomeTax: estimate.incomeTax,
        };
        for (const slot of slots) {
          await scheduleAt(slot.id, slot.at, taxReminderMessage(slot, facts, translate));
        }
      }),
    [db, enqueue]
  );

  const checkLowStock = useCallback(
    (announce: boolean) =>
      enqueue(async () => {
        const low = await lowStockVariants(db);
        const told = readLowStockTold();
        if (!announce) {
          storeLowStockTold(forgetRestocked(told, low.map((row) => row.variantId)));
          return;
        }
        const plan = planLowStock(told, low);
        const { t: translate, prefs: current, permission: allowed, ready: open } = live.current;
        const message = lowStockMessage(plan.fresh, translate);
        const sent =
          message !== null && open && current.lowStock && allowed === 'granted' && (await presentNow(message));
        storeLowStockTold(sent ? plan.notifiedIfSent : plan.notifiedIfSkipped);
      }),
    [db, enqueue]
  );

  // Launch and every return to the app: the owner may have changed the
  // permission in the phone's settings, and a day may have passed.
  useEffect(() => {
    if (!supported) return;
    void ensureChannels().then(refreshPermission);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refreshPermission().then(() => void rescheduleTax());
    });
    return () => subscription.remove();
  }, [refreshPermission, rescheduleTax]);

  // Reschedule whenever the inputs to the words or the schedule change.
  useEffect(() => {
    if (!supported) return;
    if (seesTax) void rescheduleTax();
  }, [seesTax, language, prefs.tax, permission, rescheduleTax]);

  // Signing out (or handing the phone over) cancels tax reminders. A cold start
  // begins signed out, so only a change from signed in counts.
  const wasSignedIn = useRef(false);
  useEffect(() => {
    if (wasSignedIn.current && !signedIn) {
      void enqueue(cancelTaxReminders);
      // A hand-over clears the stored switches; pick up the fresh state.
      setPrefs(readPrefs());
      setPromptDone(readPromptDone());
    }
    wasSignedIn.current = signedIn;
  }, [signedIn, enqueue]);

  // Taps go to the screen the alert is about, once the app is unlocked. Anyone
  // who cannot open that screen lands on Stock instead.
  useEffect(() => onTap(setPendingUrl), []);
  useEffect(() => {
    if (!pendingUrl || !ready) return;
    let target = pendingUrl;
    if (target.startsWith('/product/') && !canAccessScreen(role, 'productDetail')) target = '/(tabs)/products';
    if (target === '/(tabs)/tax' && !canAccessScreen(role, 'tax')) target = '/(tabs)';
    const frame = requestAnimationFrame(() => {
      router.push(target as Href);
      setPendingUrl(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [pendingUrl, ready, role]);

  const setPref = useCallback((key: keyof NotificationPrefs, on: boolean) => {
    setPrefs((current) => {
      const next = { ...current, [key]: on };
      storePrefs(next);
      return next;
    });
  }, []);

  const dismissPrompt = useCallback(() => {
    storePromptDone();
    setPromptDone(true);
  }, []);

  const turnOn = useCallback(async () => {
    const result = await requestPermission();
    setPermission(result);
    dismissPrompt();
    return result;
  }, [dismissPrompt]);

  const afterSale = useCallback(() => {
    void checkLowStock(true);
    void rescheduleTax();
  }, [checkLowStock, rescheduleTax]);

  const afterRestock = useCallback(() => void checkLowStock(false), [checkLowStock]);
  const afterTaxChange = useCallback(() => void rescheduleTax(), [rescheduleTax]);

  const sendTest = useCallback(async () => {
    const current = await permissionState();
    setPermission(current);
    if (current !== 'granted') return false;
    return presentNow({ title: t('notify.test.title'), body: t('notify.test.body'), url: '/(tabs)' });
  }, [t]);

  const value = useMemo<NotificationsValue>(
    () => ({
      supported,
      permission,
      prefs,
      setPref,
      promptVisible: supported && checked && !promptDone && permission === 'undetermined',
      turnOn,
      dismissPrompt,
      openSettings: openPhoneSettings,
      afterSale,
      afterRestock,
      afterTaxChange,
      sendTest,
    }),
    [permission, checked, prefs, setPref, promptDone, turnOn, dismissPrompt, afterSale, afterRestock, afterTaxChange, sendTest]
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

export function useNotifications(): NotificationsValue {
  const value = useContext(NotificationsContext);
  if (!value) throw new Error('useNotifications must be used inside NotificationsProvider');
  return value;
}

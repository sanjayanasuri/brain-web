/**
 * Reminder evaluation and banner management
 * Frontend-only evaluation for in-app reminders
 */

export interface ReminderPreferences {
  weekly_digest: {
    enabled: boolean;
    day_of_week: number; // 1-7 (Monday=1, Sunday=7)
    hour: number; // 0-23
  };
  review_queue: {
    enabled: boolean;
    cadence_days: number;
  };
  finance_stale: {
    enabled: boolean;
    cadence_days: number;
  };
}

export interface ReminderBanner {
  id: string;
  type: 'weekly_digest' | 'review_queue' | 'finance_stale';
  title: string;
  body: string;
  cta: {
    label: string;
    target: string;
  };
}

const DISMISS_STORAGE_KEY = 'brain-web-reminder-dismisses';
const DIGEST_OPENED_KEY = 'brain-web-digest-opened-this-week';

/**
 * Get dismissed banner timestamps from localStorage
 */
function getDismissedBanners(): Record<string, number> {
  try {
    const stored = localStorage.getItem(DISMISS_STORAGE_KEY);
    if (!stored) return {};
    return JSON.parse(stored);
  } catch {
    return {};
  }
}

/**
 * Save dismissed banner timestamp
 */
export function dismissBanner(bannerId: string): void {
  const dismissed = getDismissedBanners();
  dismissed[bannerId] = Date.now();
  try {
    localStorage.setItem(DISMISS_STORAGE_KEY, JSON.stringify(dismissed));
  } catch (e) {
    console.warn('Failed to save banner dismiss:', e);
  }
}

/**
 * Check if a banner was dismissed recently (within cadence)
 */
function isBannerDismissed(bannerId: string, cadenceDays: number): boolean {
  const dismissed = getDismissedBanners();
  const dismissedAt = dismissed[bannerId];
  if (!dismissedAt) return false;
  
  const daysSinceDismiss = (Date.now() - dismissedAt) / (1000 * 60 * 60 * 24);
  return daysSinceDismiss < cadenceDays;
}

/**
 * Mark digest as opened this week
 */
export function markDigestOpened(): void {
  try {
    const weekKey = getWeekKey();
    localStorage.setItem(DIGEST_OPENED_KEY, weekKey);
  } catch (e) {
    console.warn('Failed to mark digest opened:', e);
  }
}

/**
 * Check if digest was opened this week
 */
function wasDigestOpenedThisWeek(): boolean {
  try {
    const weekKey = getWeekKey();
    const stored = localStorage.getItem(DIGEST_OPENED_KEY);
    return stored === weekKey;
  } catch {
    return false;
  }
}

/**
 * Get a unique key for the current week (YYYY-WW format)
 */
function getWeekKey(): string {
  const now = new Date();
  const year = now.getFullYear();
  const week = getWeekNumber(now);
  return `${year}-W${week}`;
}

/**
 * Get ISO week number
 */
function getWeekNumber(date: Date): number {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  return Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
}

/**
 * Check if weekly digest reminder should show
 */
function shouldShowWeeklyDigest(
  prefs: ReminderPreferences,
  dismissed: Record<string, number>
): boolean {
  if (!prefs.weekly_digest.enabled) return false;
  
  // Check if already dismissed this week
  const bannerId = 'weekly_digest';
  if (isBannerDismissed(bannerId, 7)) return false;
  
  // Check if digest was already opened this week
  if (wasDigestOpenedThisWeek()) return false;
  
  // Check if it's past the scheduled day/hour
  const now = new Date();
  const currentDay = now.getDay() === 0 ? 7 : now.getDay(); // Convert Sunday=0 to Sunday=7
  const currentHour = now.getHours();
  
  const scheduledDay = prefs.weekly_digest.day_of_week;
  const scheduledHour = prefs.weekly_digest.hour;
  
  // Show if we're past the scheduled day, or on the scheduled day and past the hour
  if (currentDay > scheduledDay) {
    return true;
  }
  if (currentDay === scheduledDay && currentHour >= scheduledHour) {
    return true;
  }
  
  return false;
}

/**
 * Check if review queue reminder should show
 */
function shouldShowReviewQueue(
  prefs: ReminderPreferences,
  proposedCount: number,
  dismissed: Record<string, number>
): boolean {
  if (!prefs.review_queue.enabled) return false;
  if (proposedCount === 0) return false;
  
  const bannerId = 'review_queue';
  return !isBannerDismissed(bannerId, prefs.review_queue.cadence_days);
}

/**
 * Check if finance stale reminder should show
 */
function shouldShowFinanceStale(
  prefs: ReminderPreferences,
  hasStaleSnapshots: boolean,
  dismissed: Record<string, number>
): boolean {
  if (!prefs.finance_stale.enabled) return false;
  if (!hasStaleSnapshots) return false;
  
  const bannerId = 'finance_stale';
  return !isBannerDismissed(bannerId, prefs.finance_stale.cadence_days);
}

/**
 * Evaluate reminders and return banners to show
 * Returns at most 1 banner (priority: weekly_digest > review_queue > finance_stale)
 */
export async function evaluateReminders(
  prefs: ReminderPreferences,
  proposedRelationshipsCount: number = 0,
  hasStaleFinanceSnapshots: boolean = false
): Promise<ReminderBanner | null> {
  const dismissed = getDismissedBanners();
  
  // Priority order: weekly_digest > review_queue > finance_stale
  if (shouldShowWeeklyDigest(prefs, dismissed)) {
    return {
      id: 'weekly_digest',
      type: 'weekly_digest',
      title: 'Your weekly digest is ready',
      body: 'Review your activity, pending actions, and saved items from this week.',
      cta: {
        label: 'View Digest',
        target: '/digest',
      },
    };
  }
  
  if (shouldShowReviewQueue(prefs, proposedRelationshipsCount, dismissed)) {
    return {
      id: 'review_queue',
      type: 'review_queue',
      title: `${proposedRelationshipsCount} relationship${proposedRelationshipsCount !== 1 ? 's' : ''} pending review`,
      body: 'Review proposed connections in your knowledge graph.',
      cta: {
        label: 'Review',
        target: '/review?status=PROPOSED',
      },
    };
  }
  
  if (shouldShowFinanceStale(prefs, hasStaleFinanceSnapshots, dismissed)) {
    return {
      id: 'finance_stale',
      type: 'finance_stale',
      title: 'Finance snapshots need refresh',
      body: 'Some tracked companies have stale snapshots that may need updating.',
      cta: {
        label: 'View Finance',
        target: '/?lens=FINANCE',
      },
    };
  }
  
  return null;
}


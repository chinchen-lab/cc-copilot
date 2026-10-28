import type { NotificationContent, NotificationKind } from "../../shared/notifications"
import { showNotification } from "./desktopNotify"
import { isDesktopAttended } from "./desktopAttention"
import { sendPushNotification } from "./pushNotify"
import { recordNotification } from "./notificationHistory"
import { getConfig } from "../config"

/**
 * Fan a notification out to every sink, recording it in history first.
 *
 * The Electron main process suppresses enabled desktop alerts when its window
 * is focused on that same session. Push only fires when the user is *not* at the desktop,
 * so sitting in front of Cogpit never buzzes the phone. A headless server always
 * counts as unattended, which is what makes push the only working channel there.
 *
 * Never throws: notification delivery must not fail the agent turn behind it.
 */
export function deliverNotification(
  notification: NotificationContent,
  kind: NotificationKind = "system",
): void {
  const entry = recordNotification(notification, kind)
  const config = getConfig()
  if (config?.notificationsEnabled === false) return

  if (config?.desktopNotificationsEnabled !== false) {
    try {
      showNotification(notification.title, notification.body, notification.nav, entry.id)
    } catch (err) {
      console.error("[notify] Desktop notification failed:", err)
    }
  }

  if (isDesktopAttended()) return

  // Deliberately not awaited: the caller is an agent turn boundary that should
  // not wait on a round trip to a push server.
  void sendPushNotification(notification).catch((err: unknown) => {
    console.error("[notify] Push notification failed:", err)
  })
}

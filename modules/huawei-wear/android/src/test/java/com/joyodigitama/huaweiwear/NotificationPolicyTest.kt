package com.joyodigitama.huaweiwear

import android.app.Notification
import android.content.pm.ApplicationInfo
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class NotificationPolicyTest {
  private fun reason(flags: Int = 0, category: String? = null, pkg: String = "com.chat", title: String? = "Ann", body: String? = "hi") =
    NotificationPolicy.skipReason(flags, category, pkg, "com.joyodigitama.joyofit", title, body)

  @Test
  fun plainMessagePasses() {
    assertNull(reason())
  }

  @Test
  fun ownAppOngoingAndGroupSummaryAreSkipped() {
    assertEquals("own app", reason(pkg = "com.joyodigitama.joyofit"))
    assertEquals("ongoing", reason(flags = Notification.FLAG_ONGOING_EVENT))
    assertEquals("ongoing", reason(flags = Notification.FLAG_FOREGROUND_SERVICE))
    assertEquals("group summary", reason(flags = Notification.FLAG_GROUP_SUMMARY))
  }

  @Test
  fun callsMediaAndProgressAreSkipped() {
    assertEquals("call (not forwarded)", reason(category = Notification.CATEGORY_CALL))
    assertEquals("media controls", reason(category = Notification.CATEGORY_TRANSPORT))
    assertEquals("progress", reason(category = Notification.CATEGORY_PROGRESS))
    assertNull(reason(category = Notification.CATEGORY_EMAIL))
  }

  @Test
  fun earlyReasonNeedsNoText() {
    val own = "com.joyodigitama.joyofit"
    assertNull(NotificationPolicy.skipReasonEarly(0, null, "com.chat", own))
    assertEquals("own app", NotificationPolicy.skipReasonEarly(0, null, own, own))
    assertEquals("ongoing", NotificationPolicy.skipReasonEarly(Notification.FLAG_ONGOING_EVENT, null, "com.chat", own))
    assertEquals("progress", NotificationPolicy.skipReasonEarly(0, Notification.CATEGORY_PROGRESS, "com.chat", own))
    // Empty text is the one content filter that still needs the text.
    assertNull(NotificationPolicy.skipReasonEarly(0, null, "com.chat", own))
  }

  @Test
  fun emptyTextIsSkipped() {
    assertEquals("empty", reason(title = null, body = "  "))
    assertNull(reason(title = null, body = "only body"))
  }

  @Test
  fun defaultPolicyIsEverythingExceptSystemApps() {
    assertTrue(NotificationPolicy.appAllowed(null, isSystemApp = false))
    assertFalse(NotificationPolicy.appAllowed(null, isSystemApp = true))
    assertTrue(NotificationPolicy.appAllowed(true, isSystemApp = true))
    assertFalse(NotificationPolicy.appAllowed(false, isSystemApp = false))
  }

  @Test
  fun updatedSystemAppsCountAsUserApps() {
    assertTrue(NotificationPolicy.isSystemApp(ApplicationInfo.FLAG_SYSTEM))
    assertFalse(NotificationPolicy.isSystemApp(ApplicationInfo.FLAG_SYSTEM or ApplicationInfo.FLAG_UPDATED_SYSTEM_APP))
    assertFalse(NotificationPolicy.isSystemApp(0))
  }
}

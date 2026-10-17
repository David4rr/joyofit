package com.joyodigitama.huaweiwear

import android.app.Notification
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class VoipCallPolicyTest {
  private fun incoming(callType: Int? = null, flags: Int = 0, fullScreen: Boolean = false, actions: List<String?> = emptyList()) =
    VoipCallPolicy.isIncoming(callType, flags, fullScreen, actions)

  @Test
  fun callCategoryOrCallStyleIsACall() {
    assertTrue(VoipCallPolicy.isCall(Notification.CATEGORY_CALL, null))
    assertTrue(VoipCallPolicy.isCall(null, VoipCallPolicy.CALL_TYPE_INCOMING))
    assertFalse(VoipCallPolicy.isCall(Notification.CATEGORY_MESSAGE, null))
    assertFalse(VoipCallPolicy.isCall(null, null))
  }

  @Test
  fun incomingVoipCallWithFullScreenIntentRings() {
    assertTrue(incoming(flags = Notification.FLAG_ONGOING_EVENT, fullScreen = true))
    assertTrue(incoming(flags = Notification.FLAG_INSISTENT))
    assertTrue(incoming(actions = listOf("Decline", "Answer")))
    assertTrue(incoming(actions = listOf("Tolak", "Jawab")))
  }

  @Test
  fun ongoingCallDoesNotRing() {
    assertFalse(incoming(flags = Notification.FLAG_ONGOING_EVENT, actions = listOf("Hang up")))
    assertFalse(incoming(flags = Notification.FLAG_ONGOING_EVENT or Notification.FLAG_FOREGROUND_SERVICE))
    assertFalse(incoming(actions = listOf("Answer")))
    assertFalse(incoming())
  }

  @Test
  fun callStyleTypeDecidesAlone() {
    assertTrue(incoming(callType = VoipCallPolicy.CALL_TYPE_INCOMING))
    assertFalse(incoming(callType = VoipCallPolicy.CALL_TYPE_ONGOING, fullScreen = true))
    assertFalse(incoming(callType = VoipCallPolicy.CALL_TYPE_SCREENING, flags = Notification.FLAG_INSISTENT))
  }

  @Test
  fun dialerPackagesAreLeftToPhoneState() {
    assertTrue(VoipCallPolicy.isDialer("com.google.android.dialer", null))
    assertTrue(VoipCallPolicy.isDialer("com.samsung.android.incallui", null))
    assertTrue(VoipCallPolicy.isDialer("com.vendor.phone", "com.vendor.phone"))
    assertFalse(VoipCallPolicy.isDialer("com.whatsapp", "com.google.android.dialer"))
    assertFalse(VoipCallPolicy.isDialer("org.telegram.messenger", null))
  }

  @Test
  fun callerNamePrefersPersonThenTitleThenApp() {
    assertEquals("Ann", VoipCallPolicy.callerName("Ann", "WhatsApp", "WhatsApp"))
    assertEquals("Budi", VoipCallPolicy.callerName(null, " Budi ", "WhatsApp"))
    assertEquals("Signal", VoipCallPolicy.callerName(" ", null, "Signal"))
  }

  @Test
  fun actionsAreFoundByTitleOrCallStylePosition() {
    assertEquals(VoipCallPolicy.Actions(answer = 1, decline = 0), VoipCallPolicy.findActions(listOf("Decline", "Answer"), false))
    assertEquals(VoipCallPolicy.Actions(answer = null, decline = 0), VoipCallPolicy.findActions(listOf("Hang up"), false))
    assertEquals(VoipCallPolicy.Actions(answer = null, decline = null), VoipCallPolicy.findActions(listOf("Open", null), false))
    // CallStyle with titles in a language the word list lacks: decline first, answer last.
    assertEquals(VoipCallPolicy.Actions(answer = 1, decline = 0), VoipCallPolicy.findActions(listOf("X", "Y"), true))
    assertEquals(VoipCallPolicy.Actions(answer = 2, decline = 0), VoipCallPolicy.findActions(listOf("Decline", "Mute", "Z"), true))
    assertEquals(VoipCallPolicy.Actions(answer = null, decline = null), VoipCallPolicy.findActions(listOf("X"), true))
  }

  @Test
  fun incomingCallRingsOnceAndRepeatsAreDropped() {
    val tracker = VoipCallTracker<String>()
    assertEquals(VoipCallPolicy.Step.RING, tracker.onPosted("k1", true, "wa"))
    assertEquals(VoipCallPolicy.Step.NONE, tracker.onPosted("k1", true, "wa"))
    assertEquals("wa", tracker.current())
  }

  @Test
  fun ongoingCallNeverRings() {
    val tracker = VoipCallTracker<String>()
    assertEquals(VoipCallPolicy.Step.NONE, tracker.onPosted("k1", false, "wa"))
    assertEquals(VoipCallPolicy.Step.NONE, tracker.onRemoved("k1"))
    assertNull(tracker.current())
  }

  @Test
  fun removalStopsTheRingOnce() {
    val tracker = VoipCallTracker<String>()
    tracker.onPosted("k1", true, "wa")
    assertEquals(VoipCallPolicy.Step.STOP, tracker.onRemoved("k1"))
    assertEquals(VoipCallPolicy.Step.NONE, tracker.onRemoved("k1"))
    assertNull(tracker.current())
  }

  @Test
  fun answeredOnPhoneTurnsIntoStartCallAndThenNothing() {
    val tracker = VoipCallTracker<String>()
    tracker.onPosted("k1", true, "wa")
    assertEquals(VoipCallPolicy.Step.ANSWERED, tracker.onPosted("k1", false, "wa"))
    assertEquals(VoipCallPolicy.Step.NONE, tracker.onRemoved("k1"))
  }

  @Test
  fun unknownKeyRemovalDoesNotStop() {
    val tracker = VoipCallTracker<String>()
    tracker.onPosted("k1", true, "wa")
    assertEquals(VoipCallPolicy.Step.NONE, tracker.onRemoved("other"))
    assertEquals("wa", tracker.current())
  }

  @Test
  fun newestRingingCallAnswersTheWatchButtons() {
    val tracker = VoipCallTracker<String>()
    tracker.onPosted("k1", true, "wa")
    tracker.onPosted("k2", true, "tg")
    assertEquals("tg", tracker.current())
    tracker.onRemoved("k2")
    assertEquals("wa", tracker.current())
  }
}

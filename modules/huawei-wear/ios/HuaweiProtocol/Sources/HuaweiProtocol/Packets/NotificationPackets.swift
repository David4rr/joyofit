// Port of Notifications.java (service 0x02), the watch-side switch only: the phone-side forwarding (notification text, icons, replies) is
// Android's NotificationForwarder; on iOS the watch reads the iPhone's notifications itself (ANCS) once this switch is on.
import Foundation

public enum Notifications {
    public static let id: UInt8 = 0x02

    /// SetNotificationRequest (02/04): the watch's own "show notifications" switch, GB `PREF_NOTIFICATION_ENABLE`.
    public enum NotificationState {
        public static let id: UInt8 = 0x04

        public static func request(enabled: Bool) -> HuaweiPacket {
            var inner = HuaweiTLV()
            inner.put(0x02, bool: enabled)
            inner.put(0x03, bool: enabled)
            var tlv = HuaweiTLV()
            tlv.put(0x81, tlv: inner)
            return HuaweiPacket(serviceId: Notifications.id, commandId: id, tlv: tlv)
        }
    }
}

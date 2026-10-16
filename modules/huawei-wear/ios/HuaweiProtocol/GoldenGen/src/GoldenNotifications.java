import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Notifications;

import org.json.JSONArray;
import org.json.JSONObject;

/** Notifications (service 0x02): the watch-side switch request, built by the real Java class. */
public class GoldenNotifications {
    public static void main(String[] args) throws Exception {
        JSONObject root = GoldenSupport.obj();
        JSONArray requests = GoldenSupport.arr();
        for (boolean on : new boolean[] {true, false}) {
            JSONObject o = PacketsGoldenKit.request("NotificationState " + on, new Notifications.NotificationStateRequest(PacketsGoldenKit.params(), on));
            o.put("enabled", on);
            requests.put(o);
        }
        root.put("requests", requests);
        GoldenSupport.write(args[0], "notifications.json", root);
    }
}

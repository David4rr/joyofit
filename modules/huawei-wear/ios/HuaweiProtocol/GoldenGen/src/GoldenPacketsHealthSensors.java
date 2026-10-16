import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.FitnessData;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Workout;

import org.json.JSONArray;
import org.json.JSONObject;

/** The sensor switches of FitnessData (07/16, 17, 1C, 1D, 22, 23, 24), the heart-rate zone configs (07/13, 07/21) and Workout 17/17. */
public class GoldenPacketsHealthSensors {
    static JSONArray ints(int[] v) {
        if (v == null) return null;
        JSONArray a = GoldenSupport.arr();
        for (int x : v) a.put(x);
        return a;
    }

    static JSONObject zones(String name, boolean extended, boolean warning, int limit, int[] mhr, int method, int[] hrr) throws Exception {
        HuaweiPacket.ParamsProvider pp = PacketsGoldenKit.params();
        HuaweiPacket packet = extended
            ? FitnessData.HeartRateZoneConfigPacket.Request.requestExtended(pp, warning, limit, mhr, method, hrr)
            : FitnessData.HeartRateZoneConfigPacket.Request.requestSimple(pp, warning, limit, mhr);
        JSONObject o = PacketsGoldenKit.request(name, packet);
        o.put("extended", extended).put("warning", warning).put("limit", limit).put("method", method);
        o.put("mhr", mhr == null ? JSONObject.NULL : ints(mhr));
        o.put("hrr", hrr == null ? JSONObject.NULL : ints(hrr));
        return o;
    }

    static JSONObject sw(String kind, boolean on, HuaweiPacket p) throws Exception {
        JSONObject o = PacketsGoldenKit.request(kind + (on ? " on" : " off"), p);
        o.put("kind", kind).put("enabled", on);
        return o;
    }

    static JSONObject alert(String kind, boolean on, int threshold, HuaweiPacket p) throws Exception {
        JSONObject o = PacketsGoldenKit.request(kind + " " + on + " " + threshold, p);
        o.put("kind", kind).put("enabled", on).put("threshold", threshold);
        return o;
    }

    public static void main(String[] args) throws Exception {
        JSONObject root = GoldenSupport.obj();
        HuaweiPacket.ParamsProvider pp = PacketsGoldenKit.params();
        JSONArray requests = GoldenSupport.arr();
        for (boolean on : new boolean[] {true, false}) {
            requests.put(sw("truSleep", on, new FitnessData.TruSleep.Request(pp, on)));
            requests.put(sw("automaticHeartRate", on, new FitnessData.EnableAutomaticHeartrate.Request(pp, on)));
            requests.put(sw("realtimeHeartRate", on, new FitnessData.EnableRealtimeHeartRate.Request(pp, on)));
            requests.put(sw("automaticSpo2", on, new FitnessData.EnableAutomaticSpo.Request(pp, on)));
        }
        requests.put(alert("highAlert", true, 120, new FitnessData.HighHeartRateAlert.Request(pp, true, (byte) 120)));
        requests.put(alert("highAlert", false, 0, new FitnessData.HighHeartRateAlert.Request(pp, false, (byte) 0)));
        requests.put(alert("highAlert", false, 140, new FitnessData.HighHeartRateAlert.Request(pp, false, (byte) 140)));
        requests.put(alert("highAlert", true, 150, new FitnessData.HighHeartRateAlert.Request(pp, true, (byte) 150)));
        requests.put(alert("lowAlert", true, 45, new FitnessData.LowHeartRateAlert.Request(pp, true, (byte) 45)));
        requests.put(alert("lowAlert", false, 0, new FitnessData.LowHeartRateAlert.Request(pp, false, (byte) 0)));
        requests.put(alert("lowAlert", true, 40, new FitnessData.LowHeartRateAlert.Request(pp, true, (byte) 40)));
        requests.put(PacketsGoldenKit.request("notifyRestHeartRate", new FitnessData.NotifyRestHeartRate.Request(pp)).put("kind", "notifyRest"));
        requests.put(PacketsGoldenKit.request("workoutNotifyHeartRate", new Workout.NotifyHeartRate.Request(pp)).put("kind", "workoutNotify"));
        root.put("requests", requests);

        JSONArray z = GoldenSupport.arr();
        z.put(zones("simple age 35", false, true, 185, new int[] {93, 111, 130, 148, 167, 185}, 0, null));
        z.put(zones("simple without mhr", false, true, 185, null, 0, null));
        z.put(zones("simple no limit", false, true, 0, new int[] {93, 111, 130, 148, 167, 185}, 0, null));
        z.put(zones("simple zero threshold", false, false, 185, new int[] {93, 111, 130, 148, 167, 0}, 0, null));
        z.put(zones("simple bytes above 127", false, true, 200, new int[] {130, 150, 170, 190, 210, 255}, 0, null));
        z.put(zones("simple ignores hrr", false, true, 185, new int[] {93, 111, 130, 148, 167, 185}, 1, new int[] {134, 153, 165, 170, 179, 60}));
        z.put(zones("extended age 35", true, true, 185, new int[] {93, 111, 130, 148, 167, 185}, 0, new int[] {134, 153, 165, 170, 179, 60}));
        z.put(zones("extended method hrr", true, true, 185, new int[] {93, 111, 130, 148, 167, 185}, 1, new int[] {134, 153, 165, 170, 179, 60}));
        z.put(zones("extended without hrr", true, true, 185, new int[] {93, 111, 130, 148, 167, 185}, 0, null));
        z.put(zones("extended without mhr", true, false, 0, null, 0, new int[] {134, 153, 165, 170, 179, 60}));
        z.put(zones("extended wraps bytes", true, true, 300, new int[] {300, 1, 2, 3, 4, 5}, 3, new int[] {-1, 256, 257, 0, 1, 2}));
        root.put("zones", z);

        GoldenSupport.write(args[0], "packetsHealthSensors.json", root);
    }
}

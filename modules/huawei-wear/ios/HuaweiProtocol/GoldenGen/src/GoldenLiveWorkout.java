import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The TLVs of the live-workout link (Kotlin WorkoutLink.kt builds them from this Java HuaweiTLV): the 17/03 poll, the 17/12 open, the 18/01
 * and 18/02 requests and the 18/03 phone fixes for every GPS field bitmap, built here with the same put calls in the same order.
 */
public class GoldenLiveWorkout {
    static final int OK = 100000;

    static JSONObject fix(String name, int bitmap, Float speed, Double altitude, Float bearing, Float accuracy, double lat, double lon,
                          Float distance, long timeMs, long prevTimeMs, boolean hasPrev, long nowMs) {
        boolean pSpeed = (bitmap & 0x01) != 0, pDistance = (bitmap & 0x02) != 0, pAlt = (bitmap & 0x04) != 0;
        boolean pLatLon = (bitmap & 0x10) != 0, pDir = (bitmap & 0x40) != 0, pPrec = (bitmap & 0x80) != 0;
        long offsetMs = hasPrev ? timeMs - prevTimeMs : 1000L;
        HuaweiTLV point = new HuaweiTLV();
        if (pSpeed && speed != null) point.put(0x03, (short) (int) (float) speed);
        if (pDistance) point.put(0x04, hasPrev && distance != null ? (int) (float) distance : 0);
        if (pAlt && altitude != null) point.put(0x05, (short) (int) (double) altitude);
        point.put(0x07, (int) ((nowMs - offsetMs) / 1000));
        point.put(0x08, (int) (nowMs / 1000));
        if (pLatLon) point.put(0x09, lat).put(0x0A, lon);
        if (pDir && bearing != null) point.put(0x0D, (double) (float) bearing);
        if (pPrec && accuracy != null) point.put(0x0E, (double) (float) accuracy);
        HuaweiTLV tlv = new HuaweiTLV().put(0x81, new HuaweiTLV().put(0x82, point));
        JSONObject o = GoldenSupport.obj();
        o.put("name", name);
        o.put("bitmap", bitmap);
        o.put("lat", lat);
        o.put("lon", lon);
        o.put("speed", speed == null ? JSONObject.NULL : (double) (float) speed);
        o.put("altitude", altitude == null ? JSONObject.NULL : (double) altitude);
        o.put("bearing", bearing == null ? JSONObject.NULL : (double) (float) bearing);
        o.put("accuracy", accuracy == null ? JSONObject.NULL : (double) (float) accuracy);
        o.put("distance", distance == null ? JSONObject.NULL : (double) (float) distance);
        o.put("timeMs", timeMs);
        o.put("prevTimeMs", hasPrev ? (Object) prevTimeMs : JSONObject.NULL);
        o.put("nowMs", nowMs);
        o.put("tlv", GoldenSupport.hex(tlv.serialize()));
        return o;
    }

    public static void main(String[] args) throws Exception {
        JSONObject root = GoldenSupport.obj();
        root.put("status", GoldenSupport.hex(new HuaweiTLV().put(0x81).serialize()));
        root.put("reportOpen", GoldenSupport.hex(new HuaweiTLV().put(0x01, (byte) 1).serialize()));
        root.put("gpsParameters", GoldenSupport.hex(new HuaweiTLV().put(0x81).serialize()));
        root.put("gpsAnswer", GoldenSupport.hex(new HuaweiTLV().put(0x7F, OK).serialize()));
        JSONArray fixes = GoldenSupport.arr();
        long now = 1_760_600_000_123L;
        int[] bitmaps = {0x00, 0x01, 0x02, 0x04, 0x10, 0x40, 0x80, 0xD7, 0xFF};
        for (int b : bitmaps) {
            fixes.put(fix("first fix, bitmap " + b, b, 2.9f, 712.6, 271.5f, 4.5f, -6.9147, 107.6098, null, now - 400, 0, false, now));
            fixes.put(fix("second fix, bitmap " + b, b, 3.4f, -12.9, 90.0f, 12.25f, -6.91462, 107.60991, 17.8f, now, now - 1000, true, now));
            fixes.put(fix("slow fix, bitmap " + b, b, 0.0f, 0.0, 0.0f, 65.0f, 51.5074, -0.1278, 0.4f, now + 2500, now, true, now + 2500));
        }
        fixes.put(fix("fast fix over 32 km/h in m/s", 0xFF, 40000.7f, 40000.7, 359.99f, 0.5f, 89.99999, -179.99999, 123456.7f, now, now - 3000, true, now));
        fixes.put(fix("nothing the platform knows", 0xFF, null, null, null, null, 0.0, 0.0, null, now, now - 1000, true, now));
        root.put("fixes", fixes);
        GoldenSupport.write(args[0], "liveworkout.json", root);
    }
}

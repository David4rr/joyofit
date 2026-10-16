import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.DataSync;
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.datasync.HuaweiDataSyncCommon;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.util.List;

/**
 * The activity-ring goal configs (ActivityGoals.kt builds them with the real HuaweiTLV and GB's DataSync.ConfigCommand.Request) and the
 * little-endian double / big-endian int the body-metrics dictionaries carry. The builders below are the Kotlin bodies of ActivityGoalsCodec
 * line for line; the framing goes through the real GB request class.
 */
public class GoldenGoals {
    static byte[] single(int nowSec, int goal) {
        return new HuaweiTLV().put(0x01, nowSec).put(0x02, goal).serialize();
    }

    static byte[] minimal(int value) {
        ByteArrayOutputStream out = new ByteArrayOutputStream(4);
        boolean started = false;
        for (int shift : new int[] {24, 16, 8, 0}) {
            int b = (value >> shift) & 0xFF;
            if (b != 0 || started || shift == 0) {
                out.write(b);
                started = true;
            }
        }
        return out.toByteArray();
    }

    static byte[] bundle(int nowSec, int steps, int exerciseMinutes, int standHours) {
        HuaweiTLV list = new HuaweiTLV();
        int[][] pairs = {{1, steps}, {3, exerciseMinutes}, {4, standHours}};
        for (int[] p : pairs) list.put(0x83, new HuaweiTLV().put(0x04, minimal(p[0])).put(0x05, minimal(p[1])));
        return new HuaweiTLV().put(0x01, nowSec).put(0x82, list).serialize();
    }

    static JSONObject frame(String name, int id, byte[] data, long nowMs) throws Exception {
        HuaweiDataSyncCommon.ConfigData c = new HuaweiDataSyncCommon.ConfigData();
        c.configId = id;
        c.configAction = (byte) 1;
        c.configData = data;
        c.configUnknown = nowMs;
        HuaweiDataSyncCommon.ConfigCommandData d = new HuaweiDataSyncCommon.ConfigCommandData();
        d.setConfigDataList(java.util.Arrays.asList(c));
        HuaweiPacket p = new DataSync.ConfigCommand.Request(PacketsGoldenKit.params(), "hw.sport.config", "in.huawei.motion", d);
        JSONObject o = PacketsGoldenKit.request(name, p);
        o.put("configId", id);
        o.put("data", GoldenSupport.hex(data));
        o.put("nowMs", nowMs);
        return o;
    }

    static String doubleLe(double v) {
        long bits = Double.doubleToLongBits(v);
        byte[] out = new byte[8];
        for (int i = 0; i < 8; i++) {
            out[i] = (byte) bits;
            bits >>= 8;
        }
        return GoldenSupport.hex(out);
    }

    static String int32(int v) {
        return GoldenSupport.hex(new byte[] {(byte) (v >> 24), (byte) (v >> 16), (byte) (v >> 8), (byte) v});
    }

    public static void main(String[] args) throws Exception {
        JSONObject root = GoldenSupport.obj();
        int[] nows = {1_760_400_000, 0, 1};
        int[] goals = {1000, 10000, 100000, 0, 300 * 1000};
        JSONArray singles = GoldenSupport.arr();
        for (int now : nows) for (int g : goals) singles.put(GoldenSupport.obj().put("now", now).put("goal", g).put("hex", GoldenSupport.hex(single(now, g))));
        root.put("singles", singles);

        JSONArray bundles = GoldenSupport.arr();
        int[][] sets = {{10000, 30, 12}, {1000, 1, 1}, {100000, 600, 24}, {300, 255, 256}};
        for (int[] s : sets) {
            bundles.put(GoldenSupport.obj().put("now", 1_760_400_000).put("steps", s[0]).put("exercise", s[1]).put("stand", s[2])
                .put("hex", GoldenSupport.hex(bundle(1_760_400_000, s[0], s[1], s[2]))));
        }
        root.put("bundles", bundles);

        JSONArray minimals = GoldenSupport.arr();
        for (int v : new int[] {0, 1, 25, 255, 256, 300, 65535, 65536, 100000, 0x7FFFFFFF, -1}) {
            minimals.put(GoldenSupport.obj().put("value", v).put("hex", GoldenSupport.hex(minimal(v))));
        }
        root.put("minimals", minimals);

        JSONArray frames = GoldenSupport.arr();
        long nowMs = 1_760_400_000_000L;
        frames.put(frame("steps", 900200006, single(1_760_400_000, 10000), nowMs));
        frames.put(frame("calories", 900200007, single(1_760_400_000, 300 * 1000), nowMs));
        frames.put(frame("bundle", 900200002, bundle(1_760_400_000, 10000, 30, 12), nowMs));
        frames.put(frame("reminder stand", 900200004, single(1_760_400_000, 1), nowMs));
        root.put("frames", frames);

        JSONArray doubles = GoldenSupport.arr();
        for (double v : new double[] {70.5, 22.5, 0.0, 1650.0, 1e-7, -3.25, 123456.789}) doubles.put(GoldenSupport.obj().put("value", v).put("hex", doubleLe(v)));
        root.put("doubles", doubles);
        JSONArray ints = GoldenSupport.arr();
        for (int v : new int[] {0, 1650, 100000, -1, 0x7FFFFFFF}) ints.put(GoldenSupport.obj().put("value", v).put("hex", int32(v)));
        root.put("ints", ints);

        GoldenSupport.write(args[0], "goals.json", root);
    }
}

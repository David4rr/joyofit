import java.nio.ByteBuffer;
import java.util.Map;
import java.util.TreeMap;

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiGpsParser;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Workout;

import org.json.JSONArray;
import org.json.JSONObject;

/** Workout (service 0x17) requests and responses, and the `_gps.bin` parser, built and run by the real Java classes. */
public class GoldenWorkout {
    static byte[] b(int... v) {
        byte[] out = new byte[v.length];
        for (int i = 0; i < v.length; i++) out[i] = (byte) v[i];
        return out;
    }

    static Object n(Object o) {
        return o == null ? JSONObject.NULL : o;
    }

    static JSONObject rsp(String name, int command, HuaweiTLV tlv, PacketsGoldenKit.Dumper dumper, boolean aw) {
        return rsp(name, command, tlv.serialize(), dumper, aw);
    }

    static JSONObject rsp(String name, int command, byte[] tlv, PacketsGoldenKit.Dumper dumper, boolean aw) {
        HuaweiPacket.ParamsProvider pp = PacketsGoldenKit.params();
        pp.setAW(aw);
        JSONObject o = PacketsGoldenKit.response(name, 0x17, command, tlv, pp, dumper);
        o.put("aw", aw);
        return o;
    }

    static JSONObject rsp(String name, int command, HuaweiTLV tlv, PacketsGoldenKit.Dumper dumper) {
        return rsp(name, command, tlv, dumper, false);
    }

    // ---------- dumpers ----------

    static final PacketsGoldenKit.Dumper COUNT = (parsed, f) -> {
        Workout.WorkoutCount.Response r = (Workout.WorkoutCount.Response) parsed;
        f.put("count", (int) r.count);
        f.put("error", n(r.error));
        if (r.workoutNumbers == null) {
            f.put("workoutNumbers", JSONObject.NULL);
        } else {
            JSONArray a = GoldenSupport.arr();
            for (Workout.WorkoutCount.Response.WorkoutNumbers w : r.workoutNumbers) {
                a.put(GoldenSupport.obj()
                    .put("rawData", GoldenSupport.hex(w.rawData))
                    .put("workoutNumber", (int) w.workoutNumber)
                    .put("dataCount", (int) w.dataCount)
                    .put("paceCount", (int) w.paceCount)
                    .put("segmentsCount", (int) w.segmentsCount)
                    .put("spO2Count", (int) w.spO2Count)
                    .put("sectionsCount", (int) w.sectionsCount)
                    .put("trajectoriesData", (int) w.trajectoriesData)
                    .put("divingData", (int) w.divingData));
            }
            f.put("workoutNumbers", a);
        }
    };

    static final PacketsGoldenKit.Dumper TOTALS = (parsed, f) -> {
        for (java.lang.reflect.Field field : parsed.getClass().getDeclaredFields()) {
            if (!java.lang.reflect.Modifier.isPublic(field.getModifiers()) || java.lang.reflect.Modifier.isStatic(field.getModifiers())) continue;
            Object v = field.get(parsed);
            String name = field.getName();
            if (v == null) f.put(name, JSONObject.NULL);
            else if (v instanceof byte[]) f.put(name, GoldenSupport.hex((byte[]) v));
            else if (v instanceof Byte) f.put(name, ((Byte) v).intValue());
            else if (v instanceof Short) f.put(name, ((Short) v).intValue());
            else if (v instanceof Integer || v instanceof Long || v instanceof Boolean || v instanceof String) f.put(name, v);
            else if (v instanceof Map) {
                JSONObject extra = GoldenSupport.obj();
                for (Object e : new TreeMap<Object, Object>((Map<?, ?>) v).entrySet()) {
                    Map.Entry<?, ?> entry = (Map.Entry<?, ?>) e;
                    extra.put(String.valueOf(entry.getKey()), entry.getValue());
                }
                f.put(name, extra);
            } else throw new IllegalStateException("unhandled field " + name);
        }
    };

    static final PacketsGoldenKit.Dumper DATA = (parsed, f) -> {
        Workout.WorkoutData.Response r = (Workout.WorkoutData.Response) parsed;
        f.put("error", n(r.error));
        f.put("workoutNumber", (int) r.workoutNumber);
        f.put("dataNumber", (int) r.dataNumber);
        f.put("rawHeader", GoldenSupport.hex(r.rawHeader));
        f.put("rawData", GoldenSupport.hex(r.rawData));
        f.put("innerBitmap", r.innerBitmap);
        f.put("innerDataLength", r.innerDataLength);
        if (r.header == null) {
            f.put("header", JSONObject.NULL);
        } else {
            f.put("header", GoldenSupport.obj()
                .put("workoutNumber", (int) r.header.workoutNumber)
                .put("dataNumber", (int) r.header.dataNumber)
                .put("timestamp", r.header.timestamp)
                .put("interval", (int) r.header.interval)
                .put("dataCount", (int) r.header.dataCount)
                .put("dataLength", (int) r.header.dataLength)
                .put("bitmap", (int) r.header.bitmap));
        }
        JSONArray list = GoldenSupport.arr();
        if (r.dataList != null) {
            for (Workout.WorkoutData.Response.Data d : r.dataList) {
                list.put(GoldenSupport.obj()
                    .put("unknownData", d.unknownData == null ? JSONObject.NULL : GoldenSupport.hex(d.unknownData))
                    .put("heartRate", (int) d.heartRate)
                    .put("speed", (int) d.speed)
                    .put("stepRate", (int) d.stepRate)
                    .put("cadence", (int) d.cadence)
                    .put("stepLength", (int) d.stepLength)
                    .put("groundContactTime", (int) d.groundContactTime)
                    .put("impact", (int) d.impact)
                    .put("swingAngle", (int) d.swingAngle)
                    .put("foreFootLanding", (int) d.foreFootLanding)
                    .put("midFootLanding", (int) d.midFootLanding)
                    .put("backFootLanding", (int) d.backFootLanding)
                    .put("eversionAngle", (int) d.eversionAngle)
                    .put("hangTime", (int) d.hangTime)
                    .put("impactHangRate", (int) d.impactHangRate)
                    .put("rideCadence", (int) d.rideCadence)
                    .put("apBits", Float.floatToIntBits(d.ap))
                    .put("voBits", Float.floatToIntBits(d.vo))
                    .put("gtbBits", Float.floatToIntBits(d.gtb))
                    .put("vrBits", Float.floatToIntBits(d.vr))
                    .put("ceiling", (int) d.ceiling)
                    .put("temp", (int) d.temp)
                    .put("spo2", (int) d.spo2)
                    .put("cns", (int) d.cns)
                    .put("swolf", (int) d.swolf)
                    .put("strokeRate", (int) d.strokeRate)
                    .put("calories", (int) d.calories)
                    .put("cyclingPower", (int) d.cyclingPower)
                    .put("frequency", (int) d.frequency)
                    .put("altitude", n(d.altitude))
                    .put("timestamp", d.timestamp));
            }
        }
        f.put("dataList", list);
    };

    static final PacketsGoldenKit.Dumper PACE = (parsed, f) -> {
        Workout.WorkoutPace.Response r = (Workout.WorkoutPace.Response) parsed;
        f.put("error", n(r.error));
        f.put("workoutNumber", (int) r.workoutNumber);
        f.put("paceNumber", (int) r.paceNumber);
        JSONArray a = GoldenSupport.arr();
        if (r.blocks != null) {
            for (Workout.WorkoutPace.Response.Block x : r.blocks) {
                a.put(GoldenSupport.obj().put("distance", (int) x.distance).put("type", (int) x.type).put("pace", x.pace)
                    .put("pointIndex", (int) x.pointIndex).put("correction", (int) x.correction).put("hasCorrection", x.hasCorrection));
            }
        }
        f.put("blocks", a);
    };

    static final PacketsGoldenKit.Dumper SWIM = (parsed, f) -> {
        Workout.WorkoutSwimSegments.Response r = (Workout.WorkoutSwimSegments.Response) parsed;
        f.put("error", n(r.error));
        f.put("workoutNumber", (int) r.workoutNumber);
        f.put("segmentNumber", (int) r.segmentNumber);
        JSONArray a = GoldenSupport.arr();
        if (r.blocks != null) {
            for (Workout.WorkoutSwimSegments.Response.Block x : r.blocks) {
                a.put(GoldenSupport.obj().put("distance", (int) x.distance).put("type", (int) x.type).put("pace", x.pace)
                    .put("pointIndex", (int) x.pointIndex).put("segment", (int) x.segment).put("swimType", (int) x.swimType)
                    .put("strokes", (int) x.strokes).put("avgSwolf", (int) x.avgSwolf).put("time", x.time));
            }
        }
        f.put("blocks", a);
    };

    static final PacketsGoldenKit.Dumper SPO2 = (parsed, f) -> {
        Workout.WorkoutSpO2.Response r = (Workout.WorkoutSpO2.Response) parsed;
        f.put("error", n(r.error));
        f.put("spO2Number1", (int) r.spO2Number1);
        f.put("spO2Number2", (int) r.spO2Number2);
        JSONArray a = GoldenSupport.arr();
        if (r.blocks != null) {
            for (Workout.WorkoutSpO2.Response.Block x : r.blocks) a.put(GoldenSupport.obj().put("interval", x.interval).put("value", x.value));
        }
        f.put("blocks", a);
    };

    static final PacketsGoldenKit.Dumper CAPABILITY = (parsed, f) -> {
        f.put("supportNewStep", ((Workout.WorkoutCapability.Response) parsed).supportNewStep);
    };

    static final PacketsGoldenKit.Dumper SECTIONS = (parsed, f) -> {
        Workout.WorkoutSections.Response r = (Workout.WorkoutSections.Response) parsed;
        f.put("error", n(r.error));
        f.put("workoutId", (int) r.workoutId);
        f.put("number", (int) r.number);
        JSONArray a = GoldenSupport.arr();
        if (r.blocks != null) {
            for (Workout.WorkoutSections.Response.Block x : r.blocks) {
                a.put(GoldenSupport.obj().put("num", x.num).put("time", x.time).put("distance", x.distance).put("pace", x.pace)
                    .put("heartRate", x.heartRate).put("cadence", x.cadence).put("stepLength", x.stepLength).put("totalRise", x.totalRise)
                    .put("totalDescend", x.totalDescend).put("groundContactTime", x.groundContactTime).put("groundImpact", x.groundImpact)
                    .put("swingAngle", x.swingAngle).put("eversion", x.eversion).put("avgCadence", x.avgCadence)
                    .put("intervalTrainingType", x.intervalTrainingType).put("divingMaxDepth", x.divingMaxDepth)
                    .put("divingUnderwaterTime", x.divingUnderwaterTime).put("divingBreakTime", x.divingBreakTime));
            }
        }
        f.put("blocks", a);
    };

    // ---------- builders ----------

    static HuaweiTLV box(HuaweiTLV inner) {
        return new HuaweiTLV().put(0x81, inner);
    }

    static byte[] header(int wn, int dn, int ts, int interval, int count, int length, int bitmap) {
        return ByteBuffer.allocate(14).putShort((short) wn).putShort((short) dn).putInt(ts).put((byte) interval).putShort((short) count)
            .put((byte) length).putShort((short) bitmap).array();
    }

    static HuaweiTLV dataTlv(int wn, int dn, byte[] header, byte[] data, Integer innerLength, Integer innerBitmap) {
        HuaweiTLV c = new HuaweiTLV().put(0x02, (short) wn).put(0x03, (short) dn).put(0x04, header).put(0x05, data);
        if (innerLength != null) c.put(0x08, innerLength.intValue());
        if (innerBitmap != null) c.put(0x09, innerBitmap.intValue());
        return box(c);
    }

    static HuaweiTLV paceBlock(int distance, int type, int pace, Integer pointIndex, Integer correction) {
        HuaweiTLV t = new HuaweiTLV().put(0x04, (short) distance).put(0x05, (byte) type).put(0x06, pace);
        if (pointIndex != null) t.put(0x07, (short) pointIndex.intValue());
        if (correction != null) t.put(0x09, (short) correction.intValue());
        return t;
    }

    static byte[] gpsFile(boolean alt, int records, long seed, boolean tail) {
        ByteBuffer buf = ByteBuffer.allocate((alt ? 70 : 62) + records * (alt ? 19 : 15) + (tail ? 3 : 0)).order(java.nio.ByteOrder.LITTLE_ENDIAN);
        java.util.Random rnd = new java.util.Random(seed);
        buf.position(0x20);
        buf.put((byte) (alt ? 0x03 : 0x01));
        buf.putInt(1_700_000_000);
        buf.putDouble(106.8 + rnd.nextDouble());
        buf.putDouble(-6.2 + rnd.nextDouble());
        if (alt) buf.putDouble(10.0);
        buf.position(alt ? 70 : 62);
        for (int i = 0; i < records; i++) {
            buf.putShort((short) (rnd.nextInt(5) - 1));
            buf.putShort((short) rnd.nextInt(36000));
            buf.putFloat((rnd.nextFloat() - 0.5f) * 20f);
            buf.putFloat((rnd.nextFloat() - 0.5f) * 20f);
            buf.put((byte) rnd.nextInt(200));
            buf.put((byte) rnd.nextInt(100));
            buf.put((byte) (rnd.nextInt(8) == 0 ? 1 : 0));
            if (alt) {
                buf.putShort((short) (rnd.nextInt(400) - 50));
                buf.putShort((short) rnd.nextInt(100));
            }
        }
        return buf.array();
    }

    static JSONObject gpsCase(String name, byte[] data) {
        JSONObject o = GoldenSupport.obj();
        o.put("name", name);
        o.put("data", GoldenSupport.hex(data));
        try {
            HuaweiGpsParser.GpsPoint[] points = HuaweiGpsParser.parseHuaweiGps(data);
            JSONArray a = GoldenSupport.arr();
            for (HuaweiGpsParser.GpsPoint p : points) {
                a.put(GoldenSupport.obj()
                    .put("timestamp", p.timestamp)
                    .put("latBits", Long.toHexString(Double.doubleToLongBits(p.latitude)))
                    .put("lonBits", Long.toHexString(Double.doubleToLongBits(p.longitude)))
                    .put("pause", p.pause)
                    .put("altitudeSupported", p.altitudeSupported)
                    .put("altBits", Long.toHexString(Double.doubleToLongBits(p.altitude))));
            }
            o.put("ok", true);
            o.put("points", a);
        } catch (Exception e) {
            o.put("ok", false);
            o.put("exception", PacketsGoldenKit.exceptionName(e));
        }
        return o;
    }

    public static void main(String[] args) throws Exception {
        JSONObject root = GoldenSupport.obj();
        HuaweiPacket.ParamsProvider pp = PacketsGoldenKit.params();

        // ---------- requests ----------
        JSONArray requests = GoldenSupport.arr();
        for (int[] c : new int[][] {{1654819200, 1700000000}, {0, 2147483647}, {-1, 5}, {1700000000, 1700000000}}) {
            JSONObject o = PacketsGoldenKit.request("count " + c[0] + ".." + c[1], new Workout.WorkoutCount.Request(pp, c[0], c[1]));
            o.put("kind", "count").put("a", c[0]).put("b", c[1]);
            requests.put(o);
        }
        for (int number : new int[] {0, 1, 5, 255, 300, -1, 32767}) {
            JSONObject o = PacketsGoldenKit.request("totals " + number, new Workout.WorkoutTotals.Request(pp, (short) number));
            o.put("kind", "totals").put("a", number);
            requests.put(o);
            o = PacketsGoldenKit.request("capability-free spo2 " + number, new Workout.WorkoutSpO2.Request(pp, (short) number, (short) (number + 1)));
            o.put("kind", "spo2").put("a", number).put("b", number + 1);
            requests.put(o);
            o = PacketsGoldenKit.request("sections " + number, new Workout.WorkoutSections.Request(pp, (short) number, (short) 2));
            o.put("kind", "sections").put("a", number).put("b", 2);
            requests.put(o);
            o = PacketsGoldenKit.request("pace " + number, new Workout.WorkoutPace.Request(pp, (short) number, (short) 3));
            o.put("kind", "pace").put("a", number).put("b", 3);
            requests.put(o);
            o = PacketsGoldenKit.request("swim " + number, new Workout.WorkoutSwimSegments.Request(pp, (short) number, (short) 4));
            o.put("kind", "swim").put("a", number).put("b", 4);
            requests.put(o);
            for (boolean newSteps : new boolean[] {false, true}) {
                o = PacketsGoldenKit.request("data " + number + " newSteps=" + newSteps, new Workout.WorkoutData.Request(pp, (short) number, (short) 7, newSteps));
                o.put("kind", "data").put("a", number).put("b", 7).put("newSteps", newSteps);
                requests.put(o);
            }
        }
        JSONObject cap = PacketsGoldenKit.request("capability", new Workout.WorkoutCapability.Request(pp));
        cap.put("kind", "capability");
        requests.put(cap);
        root.put("requests", requests);

        // ---------- count ----------
        JSONArray count = GoldenSupport.arr();
        HuaweiTLV entry1 = new HuaweiTLV().put(0x06, (short) 5).put(0x07, (short) 2).put(0x08, (short) 1);
        HuaweiTLV entry2 = new HuaweiTLV().put(0x06, (short) 3).put(0x07, (short) 1).put(0x08, (short) 0).put(0x09, (short) 4).put(0x0c, (short) 2)
            .put(0x0d, (short) 6).put(0x0e, (byte) 1).put(0x0f, (byte) 1);
        count.put(rsp("two workouts", 0x07, box(new HuaweiTLV().put(0x02, (short) 2).put(0x85, entry1).put(0x85, entry2)), COUNT));
        count.put(rsp("zero", 0x07, box(new HuaweiTLV().put(0x02, (short) 0)), COUNT));
        count.put(rsp("zero with stray list", 0x07, box(new HuaweiTLV().put(0x02, (short) 0).put(0x85, entry1)), COUNT));
        count.put(rsp("error", 0x07, new HuaweiTLV().put(0x7f, 0x1E079), COUNT));
        count.put(rsp("error short", 0x07, new HuaweiTLV().put(0x7f, (byte) 5), COUNT));
        count.put(rsp("error with container", 0x07, new HuaweiTLV().put(0x7f, 9).put(0x81, new HuaweiTLV().put(0x02, (short) 1)), COUNT));
        count.put(rsp("no container", 0x07, new HuaweiTLV().put(0x01, (byte) 1), COUNT));
        count.put(rsp("count mismatch", 0x07, box(new HuaweiTLV().put(0x02, (short) 3).put(0x85, entry1)), COUNT));
        count.put(rsp("count but no list", 0x07, box(new HuaweiTLV().put(0x02, (short) 2)), COUNT));
        count.put(rsp("trajectories 0 only", 0x07, box(new HuaweiTLV().put(0x02, (short) 1).put(0x85,
            new HuaweiTLV().put(0x06, (short) 9).put(0x07, (short) 0).put(0x08, (short) 0).put(0x0e, (byte) 0))), COUNT));
        count.put(rsp("entry without data count", 0x07, box(new HuaweiTLV().put(0x02, (short) 1).put(0x85, new HuaweiTLV().put(0x06, (short) 9))), COUNT));
        count.put(rsp("short workout number", 0x07, box(new HuaweiTLV().put(0x02, (short) 1).put(0x85, new HuaweiTLV().put(0x06, (byte) 9)
            .put(0x07, (short) 1).put(0x08, (short) 1))), COUNT));
        count.put(rsp("empty trajectories byte", 0x07, box(new HuaweiTLV().put(0x02, (short) 1).put(0x85, new HuaweiTLV().put(0x06, (short) 9)
            .put(0x07, (short) 1).put(0x08, (short) 1).put(0x0e, new byte[0]))), COUNT));
        count.put(rsp("malformed 85", 0x07, box(new HuaweiTLV().put(0x02, (short) 1).put(0x85, b(0x06, 0x09))), COUNT));
        root.put("count", count);

        // ---------- totals ----------
        JSONArray totals = GoldenSupport.arr();
        HuaweiTLV minimal = new HuaweiTLV().put(0x02, (short) 5).put(0x04, 1700000000).put(0x05, 1700000600);
        totals.put(rsp("minimal", 0x08, box(minimal), TOTALS));
        HuaweiTLV full = new HuaweiTLV().put(0x02, (short) 5).put(0x03, (byte) 1).put(0x04, 1700000000).put(0x05, 1700000600)
            .put(0x06, 321).put(0x07, 5000).put(0x08, 6100).put(0x09, 640).put(0x0b, 123).put(0x0c, b(60, 180)).put(0x0d, 77).put(0x0e, 35)
            .put(0x10, 40000).put(0x11, (short) 900).put(0x12, 600).put(0x14, (byte) 1).put(0x15, (byte) 4).put(0x16, (short) 800)
            .put(0x17, (short) 31).put(0x18, (short) 2500).put(0x19, (short) 12).put(0x1a, (short) 45).put(0x1b, 99).put(0x1c, 1500).put(0x1d, -30)
            .put(0x20, (byte) 14).put(0x24, (byte) 2)
            .put(0x50, (short) 1).put(0x51, (short) 2).put(0x52, (short) 3).put(0x53, (short) 4).put(0x54, (short) 5).put(0x55, (short) 6)
            .put(0x56, (short) 7).put(0x57, (short) 8).put(0x58, (short) 9).put(0x59, (short) 10).put(0x5a, (short) 11)
            .put(0x5b, 77).put(0x5c, (short) 3).put(0x5d, (byte) 1).put(0x63, (short) 250).put(0x66, b(90, 80, 70))
            .put(0xe7, new HuaweiTLV().put(0x68, 300010027).put(0x69, "2"))
            .put(0xe7, new HuaweiTLV().put(0x68, 300010024).put(0x69, "12.5"))
            .put(0xe7, new HuaweiTLV().put(0x68, 1).put(0x69, "ignored"))
            .put(0xe7, new HuaweiTLV().put(0x68, 300010037));
        totals.put(rsp("full", 0x08, box(full), TOTALS));
        totals.put(rsp("diving type 25", 0x08, box(new HuaweiTLV().put(0x02, (short) 1).put(0x04, 1).put(0x05, 2).put(0x14, (byte) 25).put(0x1b, 600)), TOTALS));
        totals.put(rsp("type 0xff", 0x08, box(new HuaweiTLV().put(0x02, (short) 1).put(0x04, -5).put(0x05, -4).put(0x14, (byte) 0xFF)), TOTALS));
        totals.put(rsp("error", 0x08, new HuaweiTLV().put(0x7f, 100001), TOTALS));
        totals.put(rsp("no container", 0x08, new HuaweiTLV().put(0x01, (byte) 1), TOTALS));
        totals.put(rsp("no start", 0x08, box(new HuaweiTLV().put(0x02, (short) 5).put(0x05, 7)), TOTALS));
        totals.put(rsp("short start", 0x08, box(new HuaweiTLV().put(0x02, (short) 5).put(0x04, (short) 1).put(0x05, 7)), TOTALS));
        totals.put(rsp("one byte hr peaks", 0x08, box(new HuaweiTLV().put(0x02, (short) 5).put(0x04, 1).put(0x05, 2).put(0x0c, b(60))), TOTALS));
        totals.put(rsp("empty status", 0x08, box(new HuaweiTLV().put(0x02, (short) 5).put(0x03, new byte[0]).put(0x04, 1).put(0x05, 2)), TOTALS));
        totals.put(rsp("streak as byte", 0x08, box(new HuaweiTLV().put(0x02, (short) 5).put(0x04, 1).put(0x05, 2).put(0x5b, (byte) 200).put(0x5c, 70000)), TOTALS));
        totals.put(rsp("malformed 81", 0x08, new HuaweiTLV().put(0x81, b(0x02, 0x09)), TOTALS));
        root.put("totals", totals);

        // ---------- data ----------
        JSONArray data = GoldenSupport.arr();
        data.put(rsp("hr only", 0x0a, dataTlv(5, 0, header(5, 0, 1700000000, 5, 3, 1, 0x0001), b(120, 0, 150), null, null), DATA));
        data.put(rsp("hr speed altitude", 0x0a, dataTlv(5, 1, header(5, 1, 1700000100, 10, 2, 7, 0x0023), b(
            100, 0, 33, 0, 0, 0, 77, 101, 0, 40, 0, 0, 1, 0), null, null), DATA));
        data.put(rsp("swolf stroke rate calories power freq", 0x0a, dataTlv(5, 2, header(5, 2, 1700000200, 1, 2, 10, 0x0398), b(
            0, 40, 0, 9, 0, 100, 0, 55, 0, 3, 0, 41, 0, 10, 0, 101, 0, 56, 0, 7), null, null), DATA));
        // inner data: bitmap 0x0001 (cadence) + 0x0008 (impact) + 0x1000 (ap), explicit length 5
        data.put(rsp("inner explicit", 0x0a, dataTlv(5, 0, header(5, 0, 1700000300, 5, 2, 6, 0x0041), b(
            120, 0x00, 0x5A, 0x07, 0x00, 0x64, 130, 0x00, 0x5B, 0x08, 0x00, 0x65), 5, 0x1009), DATA));
        // inner bitmap bits that Java does not read leave unknown bytes behind
        data.put(rsp("inner unknown bits", 0x0a, dataTlv(5, 0, header(5, 0, 1700000400, 5, 1, 7, 0x0041), b(
            120, 1, 2, 3, 4, 5, 6), 6, 0x100000 | 0x0001), DATA));
        data.put(rsp("inner all known bits", 0x0a, dataTlv(5, 0, header(5, 0, 1700000500, 5, 1, 1 + 33, 0x0041), concat(b(99), seq(33)), 33, 0xFFFFF), DATA));
        // AW defaults: bitmap 0x01FF, length 13, only when the params say AW
        data.put(rsp("aw defaults", 0x0a, dataTlv(5, 0, header(5, 0, 1700000600, 5, 1, 14, 0x0041), concat(b(88), seq(13)), null, null), DATA, true));
        data.put(rsp("no aw defaults", 0x0a, dataTlv(5, 0, header(5, 0, 1700000600, 5, 1, 14, 0x0041), concat(b(88), seq(13)), null, null), DATA, false));
        data.put(rsp("inner bit 6 without inner length", 0x0a, dataTlv(5, 0, header(5, 0, 1700000700, 5, 2, 1, 0x0041), b(120, 121), null, null), DATA));
        data.put(rsp("zero samples", 0x0a, dataTlv(5, 0, header(5, 0, 1700000800, 5, 0, 0, 0x0001), new byte[0], null, null), DATA));
        data.put(rsp("negative interval", 0x0a, dataTlv(5, 0, header(5, 0, 1700000900, -2, 3, 1, 0x0001), b(1, 2, 3), null, null), DATA));
        data.put(rsp("error", 0x0a, new HuaweiTLV().put(0x7f, 0x1E079), DATA));
        data.put(rsp("no container", 0x0a, new HuaweiTLV().put(0x01, (byte) 1), DATA));
        data.put(rsp("missing raw data", 0x0a, box(new HuaweiTLV().put(0x02, (short) 5).put(0x03, (short) 0).put(0x04, header(5, 0, 1, 1, 1, 1, 1))), DATA));
        data.put(rsp("header too short", 0x0a, dataTlv(5, 0, b(1, 2, 3), b(1), null, null), DATA));
        data.put(rsp("header count mismatch", 0x0a, dataTlv(5, 0, header(5, 0, 1700000000, 5, 3, 1, 0x0001), b(120, 0), null, null), DATA));
        data.put(rsp("bitmap length mismatch", 0x0a, dataTlv(5, 0, header(5, 0, 1700000000, 5, 3, 1, 0x0003), b(120, 0, 150), null, null), DATA));
        data.put(rsp("inner length too small", 0x0a, dataTlv(5, 0, header(5, 0, 1700000000, 5, 1, 3, 0x0041), b(1, 2, 3), 2, 0x0001), DATA));
        data.put(rsp("negative count and length", 0x0a, dataTlv(5, 0, header(5, 0, 1700000000, 5, -2, -3, 0x0000), new byte[6], null, null), DATA));
        data.put(rsp("short header int", 0x0a, box(new HuaweiTLV().put(0x02, (byte) 5).put(0x03, (short) 0).put(0x04, header(5, 0, 1, 1, 0, 0, 0)).put(0x05, new byte[0])), DATA));
        root.put("data", data);

        // ---------- pace ----------
        JSONArray pace = GoldenSupport.arr();
        pace.put(rsp("two blocks", 0x0c, box(new HuaweiTLV().put(0x02, (short) 5).put(0x08, (short) 0)
            .put(0x83, paceBlock(1, 0, 330, null, null)).put(0x83, paceBlock(1, 1, 500, 12, 5000))), PACE));
        pace.put(rsp("no blocks", 0x0c, box(new HuaweiTLV().put(0x02, (short) 5).put(0x08, (short) 1)), PACE));
        pace.put(rsp("error", 0x0c, new HuaweiTLV().put(0x7f, 12), PACE));
        pace.put(rsp("no container", 0x0c, new HuaweiTLV().put(0x01, (byte) 1), PACE));
        pace.put(rsp("block without pace", 0x0c, box(new HuaweiTLV().put(0x02, (short) 5).put(0x08, (short) 0)
            .put(0x83, new HuaweiTLV().put(0x04, (short) 1).put(0x05, (byte) 0))), PACE));
        pace.put(rsp("negative correction", 0x0c, box(new HuaweiTLV().put(0x02, (short) 5).put(0x08, (short) 0)
            .put(0x83, paceBlock(-1, -1, -7, -3, -2))), PACE));
        root.put("pace", pace);

        // ---------- swim ----------
        JSONArray swim = GoldenSupport.arr();
        swim.put(rsp("full block", 0x0e, box(new HuaweiTLV().put(0x02, (short) 6).put(0x08, (short) 0).put(0x83,
            paceBlock(50, 0, 90, 3, null).put(0x09, (short) 2).put(0x0a, (byte) 3).put(0x0b, (short) 20).put(0x0c, (short) 44).put(0x0d, 61))), SWIM));
        swim.put(rsp("minimal block", 0x0e, box(new HuaweiTLV().put(0x02, (short) 6).put(0x08, (short) 1).put(0x83, paceBlock(25, 1, 100, null, null))), SWIM));
        swim.put(rsp("error", 0x0e, new HuaweiTLV().put(0x7f, 3), SWIM));
        swim.put(rsp("no container", 0x0e, new HuaweiTLV(), SWIM));
        root.put("swim", swim);

        // ---------- spo2 ----------
        JSONArray spo2 = GoldenSupport.arr();
        spo2.put(rsp("blocks", 0x14, new HuaweiTLV().put(0x01, (short) 5).put(0x02, (short) 0).put(0x83, new HuaweiTLV()
            .put(0x84, new HuaweiTLV().put(0x05, (byte) 60).put(0x06, (byte) 97)).put(0x84, new HuaweiTLV().put(0x06, (short) 95))), SPO2));
        spo2.put(rsp("no blocks", 0x14, new HuaweiTLV().put(0x01, (short) 5).put(0x02, (short) 0).put(0x83, new HuaweiTLV()), SPO2));
        spo2.put(rsp("error", 0x14, new HuaweiTLV().put(0x7f, 1), SPO2));
        spo2.put(rsp("no 83", 0x14, new HuaweiTLV().put(0x01, (short) 5).put(0x02, (short) 0), SPO2));
        spo2.put(rsp("no numbers", 0x14, new HuaweiTLV().put(0x83, new HuaweiTLV()), SPO2));
        root.put("spo2", spo2);

        // ---------- capability ----------
        JSONArray capability = GoldenSupport.arr();
        capability.put(rsp("new steps", 0x15, new HuaweiTLV().put(0x01, (byte) 2), CAPABILITY));
        capability.put(rsp("flags 3", 0x15, new HuaweiTLV().put(0x01, (byte) 3), CAPABILITY));
        capability.put(rsp("flags 1", 0x15, new HuaweiTLV().put(0x01, (byte) 1), CAPABILITY));
        capability.put(rsp("flags short", 0x15, new HuaweiTLV().put(0x01, (short) 0x0102), CAPABILITY));
        capability.put(rsp("flags int", 0x15, new HuaweiTLV().put(0x01, 2), CAPABILITY));
        capability.put(rsp("flags three bytes", 0x15, new HuaweiTLV().put(0x01, b(0, 0, 2)), CAPABILITY));
        capability.put(rsp("no flags", 0x15, new HuaweiTLV().put(0x02, (byte) 2), CAPABILITY));
        capability.put(rsp("empty flags", 0x15, new HuaweiTLV().put(0x01, new byte[0]), CAPABILITY));
        root.put("capability", capability);

        // ---------- sections ----------
        JSONArray sections = GoldenSupport.arr();
        sections.put(rsp("blocks", 0x16, new HuaweiTLV().put(0x01, (short) 5).put(0x02, (short) 0).put(0x83, new HuaweiTLV()
            .put(0x84, new HuaweiTLV().put(0x05, (byte) 1).put(0x06, 300).put(0x07, 1000).put(0x08, 330).put(0x09, (byte) 140).put(0x0a, (short) 170)
                .put(0x0b, (byte) 95).put(0x0c, 12L).put(0x0d, 15).put(0x0e, (short) 250).put(0x0f, (byte) 8).put(0x10, (byte) 3).put(0x11, (byte) 2)
                .put(0x22, (short) 168).put(0x23, (byte) 1).put(0x28, 55).put(0x29, 40).put(0x2a, 20))
            .put(0x84, new HuaweiTLV().put(0x05, (byte) 2).put(0x06, 1L << 40))), SECTIONS));
        sections.put(rsp("no blocks", 0x16, new HuaweiTLV().put(0x01, (short) 5).put(0x02, (short) 0).put(0x83, new HuaweiTLV()), SECTIONS));
        sections.put(rsp("error normal", 0x16, new HuaweiTLV().put(0x7f, 0x0001E079), SECTIONS));
        sections.put(rsp("error other", 0x16, new HuaweiTLV().put(0x7f, 7), SECTIONS));
        sections.put(rsp("no 83", 0x16, new HuaweiTLV().put(0x01, (short) 5).put(0x02, (short) 0), SECTIONS));
        sections.put(rsp("three byte time", 0x16, new HuaweiTLV().put(0x01, (short) 5).put(0x02, (short) 0).put(0x83, new HuaweiTLV()
            .put(0x84, new HuaweiTLV().put(0x06, b(1, 2, 3)))), SECTIONS));
        root.put("sections", sections);

        // ---------- gps ----------
        JSONArray gps = GoldenSupport.arr();
        gps.put(gpsCase("alt 5 records", gpsFile(true, 5, 1, false)));
        gps.put(gpsCase("alt 40 records tail", gpsFile(true, 40, 2, true)));
        gps.put(gpsCase("no alt 8 records", gpsFile(false, 8, 3, false)));
        gps.put(gpsCase("no alt 1 record", gpsFile(false, 1, 4, false)));
        gps.put(gpsCase("alt 1 record", gpsFile(true, 1, 5, false)));
        gps.put(gpsCase("alt 0 records", gpsFile(true, 0, 6, false)));
        gps.put(gpsCase("no alt 200 records", gpsFile(false, 200, 7, false)));
        gps.put(gpsCase("empty", new byte[0]));
        gps.put(gpsCase("shorter than trim", new byte[0x10]));
        gps.put(gpsCase("only the type byte", new byte[0x21]));
        gps.put(gpsCase("start values cut", new byte[0x30]));
        gps.put(gpsCase("header cut before padding", new byte[61]));
        gps.put(gpsCase("alt header cut", concat(new byte[0x20], b(3), new byte[40])));
        byte[] garbled = gpsFile(false, 10, 8, false);
        java.util.Arrays.fill(garbled, 0x25, 0x35, (byte) 0xFF);
        gps.put(gpsCase("garbled start values", garbled));
        root.put("gps", gps);

        GoldenSupport.write(args[0], "workout.json", root);
    }

    static byte[] concat(byte[]... parts) {
        return PacketsGoldenKit.cat(parts);
    }

    static byte[] seq(int n) {
        byte[] out = new byte[n];
        for (int i = 0; i < n; i++) out[i] = (byte) (i * 7 + 1);
        return out;
    }
}

import java.util.Random;

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.FitnessData;

import org.json.JSONArray;
import org.json.JSONObject;

/** FitnessData (service 0x07): requests and responses, built and parsed by the real Java classes. */
public class GoldenPacketsFitness {
    static byte[] b(int... v) {
        byte[] out = new byte[v.length];
        for (int i = 0; i < v.length; i++) out[i] = (byte) v[i];
        return out;
    }

    static HuaweiTLV step(int number, int timestamp, byte[]... subs) {
        HuaweiTLV container = new HuaweiTLV().put(0x02, (short) number).put(0x03, timestamp);
        for (int i = 0; i < subs.length; i++) {
            container.put(0x84, new HuaweiTLV().put(0x05, (byte) (i * 2 + 1)).put(0x06, subs[i]));
        }
        return new HuaweiTLV().put(0x81, container);
    }

    static final PacketsGoldenKit.Dumper STEP_DUMPER = (parsed, fields) -> {
        FitnessData.MessageData.StepResponse r = (FitnessData.MessageData.StepResponse) parsed;
        fields.put("number", (int) r.number);
        fields.put("timestamp", r.timestamp);
        JSONArray cs = GoldenSupport.arr();
        for (FitnessData.MessageData.StepResponse.SubContainer c : r.containers) {
            JSONObject o = GoldenSupport.obj();
            o.put("timestampOffset", (int) c.timestampOffset);
            o.put("data", GoldenSupport.hex(c.data));
            o.put("timestamp", c.timestamp);
            o.put("parsed", c.parsedData != null);
            o.put("error", c.parsedDataError);
            JSONArray tvs = GoldenSupport.arr();
            if (c.parsedData != null) {
                for (FitnessData.MessageData.StepResponse.SubContainer.TV tv : c.parsedData) {
                    tvs.put(GoldenSupport.obj().put("bitmap", (int) tv.bitmap).put("tag", (int) tv.tag).put("value", (int) tv.value));
                }
            }
            o.put("tvs", tvs);
            o.put("steps", c.steps);
            o.put("calories", c.calories);
            o.put("distance", c.distance);
            o.put("heartrate", c.heartrate);
            o.put("spo", c.spo);
            o.put("restingHeartRate", c.restingHeartRate);
            JSONArray unknown = GoldenSupport.arr();
            if (c.unknownTVs != null) {
                for (FitnessData.MessageData.StepResponse.SubContainer.TV tv : c.unknownTVs) {
                    unknown.put(GoldenSupport.obj().put("bitmap", (int) tv.bitmap).put("tag", (int) tv.tag).put("value", (int) tv.value));
                }
            }
            o.put("unknownTVs", c.unknownTVs == null ? JSONObject.NULL : unknown);
            cs.put(o);
        }
        fields.put("containers", cs);
    };

    static final PacketsGoldenKit.Dumper SLEEP_DUMPER = (parsed, fields) -> {
        FitnessData.MessageData.SleepResponse r = (FitnessData.MessageData.SleepResponse) parsed;
        fields.put("number", (int) r.number);
        JSONArray cs = GoldenSupport.arr();
        for (FitnessData.MessageData.SleepResponse.SubContainer c : r.containers) {
            cs.put(GoldenSupport.obj().put("type", (int) c.type).put("timestamp", GoldenSupport.hex(c.timestamp)));
        }
        fields.put("containers", cs);
    };

    static JSONObject stepResponse(String name, HuaweiTLV tlv) {
        return PacketsGoldenKit.response(name, 0x07, FitnessData.MessageData.stepId, tlv.serialize(), PacketsGoldenKit.params(), STEP_DUMPER);
    }

    static JSONObject stepResponse(String name, byte[] tlv) {
        return PacketsGoldenKit.response(name, 0x07, FitnessData.MessageData.stepId, tlv, PacketsGoldenKit.params(), STEP_DUMPER);
    }

    static JSONObject sleepResponse(String name, byte[] tlv) {
        return PacketsGoldenKit.response(name, 0x07, FitnessData.MessageData.sleepId, tlv, PacketsGoldenKit.params(), SLEEP_DUMPER);
    }

    static HuaweiTLV userInfoDataRequestCase(JSONArray out, String name, int height, float weight, int age, int birthday, int gender,
                                            boolean unknownGender, boolean vo2, int vo2Max, int vo2Time, boolean precision) throws Exception {
        FitnessData.UserInfo.UserInfoData d = new FitnessData.UserInfo.UserInfoData(height, weight, age, birthday, (byte) gender, unknownGender, vo2, vo2Max, vo2Time, precision);
        JSONObject o = PacketsGoldenKit.request(name, new FitnessData.UserInfo.Request(PacketsGoldenKit.params(), d));
        o.put("height", height);
        o.put("weightBits", Float.floatToIntBits(weight));
        o.put("age", age);
        o.put("birthday", birthday);
        o.put("gender", gender);
        o.put("unknownGender", unknownGender);
        o.put("vo2", vo2);
        o.put("vo2Max", vo2Max);
        o.put("vo2Time", vo2Time);
        o.put("precision", precision);
        out.put(o);
        return null;
    }

    public static void main(String[] args) throws Exception {
        JSONObject root = GoldenSupport.obj();
        HuaweiPacket.ParamsProvider pp = PacketsGoldenKit.params();

        // ---------- requests ----------
        JSONArray requests = GoldenSupport.arr();
        requests.put(PacketsGoldenKit.request("FitnessTotals", new FitnessData.FitnessTotals.Request(pp)));
        for (int start : new int[] {946684800, 1792000000, 0}) {
            requests.put(PacketsGoldenKit.request("MessageCount step " + start, new FitnessData.MessageCount.Request(pp, FitnessData.MessageCount.stepId, start, start + 1000)));
            requests.put(PacketsGoldenKit.request("MessageCount sleep " + start, new FitnessData.MessageCount.Request(pp, FitnessData.MessageCount.sleepId, start, 2147483647)));
        }
        for (int count : new int[] {0, 1, 255, 300, -1, 32767}) {
            requests.put(PacketsGoldenKit.request("MessageData step " + count, new FitnessData.MessageData.Request(pp, FitnessData.MessageData.stepId, (short) count)));
            requests.put(PacketsGoldenKit.request("MessageData sleep " + count, new FitnessData.MessageData.Request(pp, FitnessData.MessageData.sleepId, (short) count)));
        }
        JSONArray goals = GoldenSupport.arr();
        // goalType, frameType, stepGoal, calorieGoal, durationGoal
        int[][] goalCases = {
            {1, 0, 10000, 0, 0}, {1, 1, 10000, 0, 0}, {1, 5, 7000, 100, 3}, {2, 1, -5, 7, 7}, {1, 1, 0, 0, 0}, {1, 1, 7, 0, 0},
            {1, 0, 0x7FFFFFFF, 1, 1}, {0, 0, 1, 1, 1}, {1, 1, 29, 1, 1}, {1, 1, 30, 1, 1}, {1, 1, -31, 1, 1}, {3, 0xFF, 123456, 99, 99},
        };
        for (int[] c : goalCases) {
            JSONObject o = PacketsGoldenKit.request("MotionGoal " + java.util.Arrays.toString(c),
                new FitnessData.MotionGoal.Request(pp, (byte) c[0], (byte) c[1], c[2], c[3], (short) c[4]));
            o.put("goalType", c[0]);
            o.put("frameType", c[1]);
            o.put("stepGoal", c[2]);
            o.put("calorieGoal", c[3]);
            o.put("durationGoal", c[4]);
            goals.put(o);
        }
        root.put("motionGoals", goals);

        JSONArray userInfos = GoldenSupport.arr();
        int birthday = (1990 << 16) + (1 << 8) + 1;
        userInfoDataRequestCase(userInfos, "male 175/65.3", 175, 65.3f, 36, birthday, 1, false, false, 0, 0, false);
        userInfoDataRequestCase(userInfos, "female precision", 160, 52.75f, 29, birthday, 2, false, false, 0, 0, true);
        userInfoDataRequestCase(userInfos, "unknown gender unsupported", 170, 70f, 40, birthday, 3, false, false, 0, 0, false);
        userInfoDataRequestCase(userInfos, "unknown gender supported", 170, 70f, 40, birthday, 3, true, false, 0, 0, false);
        userInfoDataRequestCase(userInfos, "invalid gender 7", 170, 70f, 40, birthday, 7, true, false, 0, 0, false);
        userInfoDataRequestCase(userInfos, "invalid gender 0", 170, 70f, 40, birthday, 0, true, false, 0, 0, false);
        userInfoDataRequestCase(userInfos, "birthday 0", 170, 70f, 40, 0, 1, false, false, 0, 0, false);
        userInfoDataRequestCase(userInfos, "birthday negative", 170, 70f, 40, -1, 1, false, false, 0, 0, false);
        userInfoDataRequestCase(userInfos, "vo2", 170, 70f, 40, birthday, 1, false, true, 42, 99999, false);
        userInfoDataRequestCase(userInfos, "vo2 and precision", 170, 70.55f, 40, birthday, 2, false, true, -1, 7, true);
        userInfoDataRequestCase(userInfos, "height 0 weight 0 (defaults)", 0, 0f, 0, birthday, 1, false, false, 0, 0, true);
        userInfoDataRequestCase(userInfos, "height negative weight negative", -5, -2f, -1, birthday, 1, false, false, 0, 0, true);
        userInfoDataRequestCase(userInfos, "height 300 weight 130.7", 300, 130.7f, 300, birthday, 1, false, false, 0, 0, true);
        userInfoDataRequestCase(userInfos, "height 255 weight 255.9", 255, 255.9f, 255, birthday, 1, false, false, 0, 0, true);
        userInfoDataRequestCase(userInfos, "huge", 100000, 1e9f, 100000, birthday, 1, false, false, 0, 0, true);
        userInfoDataRequestCase(userInfos, "nan weight", 170, Float.NaN, 40, birthday, 1, false, false, 0, 0, true);
        userInfoDataRequestCase(userInfos, "weight 0.4", 170, 0.4f, 40, birthday, 1, false, false, 0, 0, true);
        // Every height 100..230: the rounding of 0.42f/0.83f * height must agree.
        for (int h = 100; h <= 230; h++) {
            userInfoDataRequestCase(userInfos, "height " + h, h, 61.37f + h * 0.1f, 33, birthday, 1, false, false, 0, 0, true);
        }
        root.put("userInfos", userInfos);
        root.put("requests", requests);

        // ---------- responses ----------
        JSONArray responses = GoldenSupport.arr();

        // MessageCount.Response (0a step, 0c sleep)
        for (int id : new int[] {0x0A, 0x0C}) {
            responses.put(PacketsGoldenKit.response("MessageCount " + id + " ok", 0x07, id, new HuaweiTLV().put(0x81, new HuaweiTLV().put(0x02, (short) 12))));
            responses.put(PacketsGoldenKit.response("MessageCount " + id + " zero", 0x07, id, new HuaweiTLV().put(0x81, new HuaweiTLV().put(0x02, (short) 0))));
            responses.put(PacketsGoldenKit.response("MessageCount " + id + " negative", 0x07, id, new HuaweiTLV().put(0x81, new HuaweiTLV().put(0x02, (short) 0xFFFF))));
            responses.put(PacketsGoldenKit.response("MessageCount " + id + " no container", 0x07, id, new HuaweiTLV().put(0x01, (byte) 1)));
            responses.put(PacketsGoldenKit.response("MessageCount " + id + " container without count", 0x07, id, new HuaweiTLV().put(0x81, new HuaweiTLV().put(0x03, (short) 1))));
            responses.put(PacketsGoldenKit.response("MessageCount " + id + " one byte count", 0x07, id, new HuaweiTLV().put(0x81, new HuaweiTLV().put(0x02, (byte) 3))));
            responses.put(PacketsGoldenKit.response("MessageCount " + id + " four byte count", 0x07, id, new HuaweiTLV().put(0x81, new HuaweiTLV().put(0x02, 0x00050006))));
            responses.put(PacketsGoldenKit.response("MessageCount " + id + " malformed container", 0x07, id, new HuaweiTLV().put(0x81, b(0x02, 0x09))));
            responses.put(PacketsGoldenKit.response("MessageCount " + id + " empty container tag", 0x07, id, new HuaweiTLV().put(0x81)));
        }

        // SleepResponse
        responses.put(sleepResponse("Sleep two containers", new HuaweiTLV().put(0x81, new HuaweiTLV()
            .put(0x02, (short) 3)
            .put(0x83, new HuaweiTLV().put(0x04, (byte) 0x07).put(0x05, b(0x69, 0x00, 0x00, 0x00, 0x00, 0x1E)))
            .put(0x83, new HuaweiTLV().put(0x04, (byte) 0xFF).put(0x05, b(0x7F, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF)))).serialize()));
        responses.put(sleepResponse("Sleep none", new HuaweiTLV().put(0x81, new HuaweiTLV().put(0x02, (short) 1)).serialize()));
        responses.put(sleepResponse("Sleep no number", new HuaweiTLV().put(0x81, new HuaweiTLV().put(0x83, new HuaweiTLV().put(0x04, (byte) 1).put(0x05, b(1, 2, 3, 4, 5, 6)))).serialize()));
        responses.put(sleepResponse("Sleep no container", new HuaweiTLV().put(0x01, (byte) 1).serialize()));
        responses.put(sleepResponse("Sleep sub without type", new HuaweiTLV().put(0x81, new HuaweiTLV().put(0x02, (short) 1).put(0x83, new HuaweiTLV().put(0x05, b(1, 2, 3, 4, 5, 6)))).serialize()));
        responses.put(sleepResponse("Sleep sub without timestamp", new HuaweiTLV().put(0x81, new HuaweiTLV().put(0x02, (short) 1).put(0x83, new HuaweiTLV().put(0x04, (byte) 1))).serialize()));
        responses.put(sleepResponse("Sleep sub empty type", new HuaweiTLV().put(0x81, new HuaweiTLV().put(0x02, (short) 1).put(0x83, new HuaweiTLV().put(0x04).put(0x05, b(1, 2, 3, 4, 5, 6)))).serialize()));
        responses.put(sleepResponse("Sleep short timestamp", new HuaweiTLV().put(0x81, new HuaweiTLV().put(0x02, (short) 1).put(0x83, new HuaweiTLV().put(0x04, (byte) 1).put(0x05, b(1, 2, 3)))).serialize()));
        responses.put(sleepResponse("Sleep sub malformed", new HuaweiTLV().put(0x81, new HuaweiTLV().put(0x02, (short) 1).put(0x83, b(0x04, 0x09))).serialize()));
        responses.put(sleepResponse("Sleep number one byte", new HuaweiTLV().put(0x81, new HuaweiTLV().put(0x02, (byte) 1)).serialize()));

        // StepResponse
        {
            byte[] steps = b(0x0E, 0x01, 0x00, 0x00, 0x2A, 0x00, 0x64); // steps 256, calories 42, distance 100
            responses.put(stepResponse("Step basic", step(0, 1792000000, steps)));
            responses.put(stepResponse("Step number 5 negative offsets", step(5, 1792000000, steps, b(0x02, 0xFF, 0xFF))));
            responses.put(stepResponse("Step timestamp overflow", step(1, 0x7FFFFFF0, steps, steps, steps, steps, steps, steps, steps, steps, steps, steps)));
            responses.put(stepResponse("Step no subcontainers", step(2, 1792000000)));
            responses.put(stepResponse("Step with heart rate", step(1, 1792000000, b(0x4E, 0x00, 0x0A, 0x00, 0x05, 0x00, 0x03, 0xB4), b(0x42, 0x00, 0x00, 0x00))));
            responses.put(stepResponse("Step bitmap2 spo and resting", step(1, 1792000000, b(0x82, 0x03, 0x00, 0x07, 0x61, 0x3C))));
            responses.put(stepResponse("Step bitmap2 unknown bits", step(1, 1792000000, b(0x80, 0xFC, 1, 2, 3, 4, 5, 6))));
            responses.put(stepResponse("Step bitmap2 only (empty bitmap1)", step(1, 1792000000, b(0x80, 0x01, 0xFF))));
            responses.put(stepResponse("Step bitmap2 zero", step(1, 1792000000, b(0x80, 0x00))));
            responses.put(stepResponse("Step single byte tags", step(1, 1792000000, b(0x60, 0xFE, 0x80))));
            responses.put(stepResponse("Step first bit", step(1, 1792000000, b(0x01, 0xFF, 0xFE))));
            responses.put(stepResponse("Step trailing data", step(1, 1792000000, b(0x02, 0x00, 0x05, 0xDE, 0xAD))));
            responses.put(stepResponse("Step missing bitmap", step(1, 1792000000, b())));
            responses.put(stepResponse("Step second bitmap missing", step(1, 1792000000, b(0x80))));
            responses.put(stepResponse("Step too short", step(1, 1792000000, b(0x0E, 0x01, 0x00))));
            responses.put(stepResponse("Step too short single", step(1, 1792000000, b(0x20))));
            responses.put(stepResponse("Step too short bitmap2", step(1, 1792000000, b(0x82, 0x03, 0x00, 0x07, 0x61))));
            responses.put(stepResponse("Step no container", new HuaweiTLV().put(0x01, (byte) 1)));
            responses.put(stepResponse("Step container without number", new HuaweiTLV().put(0x81, new HuaweiTLV().put(0x03, 1792000000))));
            responses.put(stepResponse("Step container without timestamp", new HuaweiTLV().put(0x81, new HuaweiTLV().put(0x02, (short) 1))));
            responses.put(stepResponse("Step sub without offset", new HuaweiTLV().put(0x81, new HuaweiTLV().put(0x02, (short) 1).put(0x03, 5).put(0x84, new HuaweiTLV().put(0x06, b(0x02, 0, 1))))));
            responses.put(stepResponse("Step sub without data", new HuaweiTLV().put(0x81, new HuaweiTLV().put(0x02, (short) 1).put(0x03, 5).put(0x84, new HuaweiTLV().put(0x05, (byte) 1)))));
            responses.put(stepResponse("Step sub empty offset", new HuaweiTLV().put(0x81, new HuaweiTLV().put(0x02, (short) 1).put(0x03, 5).put(0x84, new HuaweiTLV().put(0x05).put(0x06, b(0x02, 0, 1))))));
            responses.put(stepResponse("Step short timestamp", new HuaweiTLV().put(0x81, new HuaweiTLV().put(0x02, (short) 1).put(0x03, b(1, 2)))));
            responses.put(stepResponse("Step malformed sub", new HuaweiTLV().put(0x81, new HuaweiTLV().put(0x02, (short) 1).put(0x03, 5).put(0x84, b(0x05, 0x09)))));
            responses.put(stepResponse("Step offset -128", new HuaweiTLV().put(0x81, new HuaweiTLV().put(0x02, (short) 1).put(0x03, 1000000).put(0x84, new HuaweiTLV().put(0x05, (byte) 0x80).put(0x06, steps)))));
        }
        // Randomised data bytes: 600 single-subcontainer responses, so every parseData branch is compared, not just the hand-picked ones.
        JSONArray fuzz = GoldenSupport.arr();
        Random rnd = new Random(20261016);
        for (int i = 0; i < 600; i++) {
            int len = rnd.nextInt(14);
            byte[] data = new byte[len];
            rnd.nextBytes(data);
            if (len > 0 && rnd.nextInt(3) > 0) data[0] &= (byte) (rnd.nextBoolean() ? 0x7F : 0xFF); // bias towards the first bitmap having bit 7 clear
            if (len > 1 && rnd.nextInt(4) == 0) data[1] = (byte) (rnd.nextInt(4) == 0 ? 0 : data[1]);
            int ts = rnd.nextInt();
            int offset = rnd.nextInt(256) - 128;
            HuaweiTLV container = new HuaweiTLV().put(0x02, (short) rnd.nextInt(65536)).put(0x03, ts)
                .put(0x84, new HuaweiTLV().put(0x05, (byte) offset).put(0x06, data));
            fuzz.put(stepResponse("fuzz " + i, new HuaweiTLV().put(0x81, container)));
        }
        root.put("stepFuzz", fuzz);

        // FitnessTotals.Response
        responses.put(PacketsGoldenKit.response("Totals one container", 0x07, 0x03, new HuaweiTLV().put(0x81, new HuaweiTLV()
            .put(0x83, new HuaweiTLV().put(0x05, 5000).put(0x06, (short) 200).put(0x07, 3800)))));
        responses.put(PacketsGoldenKit.response("Totals three containers with gaps", 0x07, 0x03, new HuaweiTLV().put(0x81, new HuaweiTLV()
            .put(0x83, new HuaweiTLV().put(0x05, 1000))
            .put(0x83, new HuaweiTLV().put(0x06, (short) -7).put(0x07, 40))
            .put(0x83, new HuaweiTLV().put(0x05, -10).put(0x06, (short) 30000)))));
        responses.put(PacketsGoldenKit.response("Totals overflow", 0x07, 0x03, new HuaweiTLV().put(0x81, new HuaweiTLV()
            .put(0x83, new HuaweiTLV().put(0x05, 0x7FFFFFFF).put(0x07, 0x7FFFFFFF))
            .put(0x83, new HuaweiTLV().put(0x05, 10).put(0x07, 10)))));
        responses.put(PacketsGoldenKit.response("Totals no containers", 0x07, 0x03, new HuaweiTLV().put(0x81, new HuaweiTLV().put(0x02, (short) 1))));
        responses.put(PacketsGoldenKit.response("Totals no 0x81", 0x07, 0x03, new HuaweiTLV().put(0x01, (byte) 1)));
        responses.put(PacketsGoldenKit.response("Totals short steps", 0x07, 0x03, new HuaweiTLV().put(0x81, new HuaweiTLV().put(0x83, new HuaweiTLV().put(0x05, b(1, 2))))));
        responses.put(PacketsGoldenKit.response("Totals short calories", 0x07, 0x03, new HuaweiTLV().put(0x81, new HuaweiTLV().put(0x83, new HuaweiTLV().put(0x06, b(1))))));
        responses.put(PacketsGoldenKit.response("Totals malformed sub", 0x07, 0x03, new HuaweiTLV().put(0x81, new HuaweiTLV().put(0x83, b(0x05, 0x09)))));
        root.put("responses", responses);

        GoldenSupport.write(args[0], "packetsFitness.json", root);
    }
}

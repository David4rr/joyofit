import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Random;

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.HrRriTest;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Stress;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.stress.HuaweiStressHRVCalculation;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.stress.HuaweiStressScoreCalculation;

import org.json.JSONArray;
import org.json.JSONObject;

/** The stress model (HRV features and score) and the 20/09 and 19/01 requests, run by the real Java classes. */
public class GoldenStress {
    static JSONArray ints(List<Integer> v) {
        JSONArray a = GoldenSupport.arr();
        for (int x : v) a.put(x);
        return a;
    }

    static JSONArray bits(float[] f) {
        if (f == null) return null;
        JSONArray a = GoldenSupport.arr();
        for (float x : f) a.put(Float.floatToIntBits(x));
        return a;
    }

    static int successes = 0;

    static JSONObject calc(String name, List<Integer> rri, List<Integer> sqi, int signalTime) {
        JSONObject o = GoldenSupport.obj();
        o.put("name", name);
        o.put("rri", ints(rri));
        o.put("sqi", ints(sqi));
        o.put("signalTime", signalTime);
        float[] features = new HuaweiStressHRVCalculation().calculateStressHRVParameters(rri, sqi, signalTime);
        o.put("features", features == null ? JSONObject.NULL : bits(features));
        if (features != null) successes++;
        return o;
    }

    static List<Integer> list(int n, int value) {
        List<Integer> l = new ArrayList<>();
        for (int i = 0; i < n; i++) l.add(value);
        return l;
    }

    /** A resting series: mean interval and a slow respiratory swing plus noise, like a real minute of PPG intervals. */
    static List<Integer> series(long seed, int count, int mean, int swing, int noise) {
        Random r = new Random(seed);
        List<Integer> l = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            double value = mean + swing * Math.sin(i * 0.55) + r.nextGaussian() * noise;
            l.add((int) Math.round(value));
        }
        return l;
    }

    static JSONObject score(String name, float[] features) {
        JSONObject o = GoldenSupport.obj();
        o.put("name", name);
        o.put("features", bits(features));
        float factor = HuaweiStressScoreCalculation.calculateScoreFactor(features);
        byte score = HuaweiStressScoreCalculation.calculateNormalizedFinalScore(factor);
        o.put("factor", Float.floatToIntBits(factor));
        o.put("score", (int) score);
        o.put("level", (int) HuaweiStressScoreCalculation.calculateLevel(score));
        return o;
    }

    static JSONObject automatic(String name, int status, int score, float[] features, int time) throws Exception {
        List<Float> list = null;
        if (features != null) {
            list = new ArrayList<>();
            for (float f : features) list.add(f);
        }
        JSONObject o = PacketsGoldenKit.request(name, new Stress.AutomaticStress.Request(PacketsGoldenKit.params(), (byte) status, (byte) score, list, time));
        o.put("status", status).put("score", score).put("time", time);
        o.put("features", features == null ? JSONObject.NULL : bits(features));
        return o;
    }

    public static void main(String[] args) throws Exception {
        JSONObject root = GoldenSupport.obj();

        JSONArray calcs = GoldenSupport.arr();
        List<Integer> fixed = new ArrayList<>();
        for (int i = 0; i < 70; i++) fixed.add(860 + ((i * 37) % 61 - 30) + (i % 9 < 4 ? 20 : -20));
        calcs.put(calc("fixed 70 beats from the Kotlin test", fixed, list(70, 100), 60));
        calcs.put(calc("fixed signal time 51", fixed, list(70, 100), 51));
        calcs.put(calc("fixed signal time 69", fixed, list(70, 100), 69));
        calcs.put(calc("fixed signal time 50 is refused", fixed, list(70, 100), 50));
        calcs.put(calc("fixed signal time 70 is refused", fixed, list(70, 100), 70));
        calcs.put(calc("fixed 45 s is refused", fixed, list(70, 100), 45));
        calcs.put(calc("fixed 75 s is refused", fixed, list(70, 100), 75));
        calcs.put(calc("25 beats", fixed.subList(0, 25), list(25, 100), 60));
        calcs.put(calc("30 beats", fixed.subList(0, 30), list(30, 100), 60));
        calcs.put(calc("sqi not 100", fixed, list(70, 50), 60));
        calcs.put(calc("sqi shorter than rri", fixed, list(60, 100), 60));
        calcs.put(calc("211 beats", series(1, 211, 300, 10, 5), list(211, 100), 60));
        List<Integer> mixed = new ArrayList<>();
        for (int i = 0; i < 70; i++) mixed.add(i % 7 == 3 ? 50 : 100);
        calcs.put(calc("a tenth of the beats below sqi 100", fixed, mixed, 60));
        calcs.put(calc("all intervals outliers", list(40, 1500), list(40, 100), 60));
        calcs.put(calc("cumulative above 65000", series(2, 60, 1300, 20, 10), list(60, 100), 60));
        calcs.put(calc("flat", list(70, 860), list(70, 100), 60));
        calcs.put(calc("wide range", series(3, 70, 850, 300, 120), list(70, 100), 60));
        List<Integer> overflow = new ArrayList<>();
        Random r = new Random(4);
        for (int i = 0; i < 155; i++) overflow.add(401 + r.nextInt(19));
        calcs.put(calc("155 beats in one 20 ms bucket (Java byte counter wraps)", overflow, list(155, 100), 60));
        calcs.put(calc("150 beats same bucket below the wrap", overflow.subList(0, 120), list(120, 100), 60));
        int[] means = {640, 700, 760, 820, 860, 900, 950, 1000, 1100};
        int seed = 10;
        for (int mean : means) {
            for (int swing : new int[] {15, 40, 80}) {
                for (int noise : new int[] {8, 25}) {
                    int count = Math.min(205, (int) (60000.0 / mean));
                    seed++;
                    calcs.put(calc("series mean " + mean + " swing " + swing + " noise " + noise, series(seed, count, mean, swing, noise), list(count, 100), 60));
                    // The same intervals, one in eight of them marked unusable and one doubled (a missed beat).
                    List<Integer> rri = new ArrayList<>(series(seed, count, mean, swing, noise));
                    List<Integer> sqi = list(count, 100);
                    for (int i = 5; i < count; i += 8) sqi.set(i, 0);
                    rri.set(count / 2, rri.get(count / 2) * 2);
                    calcs.put(calc("noisy mean " + mean + " swing " + swing + " noise " + noise, rri, sqi, 59));
                }
            }
        }
        // Long and short windows, random quality values.
        for (int i = 0; i < 12; i++) {
            Random q = new Random(100 + i);
            int count = 40 + q.nextInt(150);
            List<Integer> rri = series(200 + i, count, 500 + q.nextInt(500), 30 + q.nextInt(50), 10 + q.nextInt(30));
            List<Integer> sqi = new ArrayList<>();
            for (int k = 0; k < count; k++) sqi.add(q.nextInt(10) == 0 ? q.nextInt(100) : 100);
            calcs.put(calc("random " + i, rri, sqi, 51 + q.nextInt(18)));
        }
        root.put("calculations", calcs);
        System.out.println("stress calculations that produced features: " + successes + " of " + calcs.length());

        JSONArray scores = GoldenSupport.arr();
        scores.put(score("mid", new float[] {19.4f, 5.5f, 184f, 33.5f, 33f, 678f, 0.43f, 148f, 208f, 37.6f}));
        scores.put(score("calm", new float[] {40f, 8f, 260f, 20f, 60f, 900f, 0.8f, 300f, 400f, 60f}));
        scores.put(score("stressed", new float[] {5f, 1.5f, 60f, 60f, 10f, 500f, 0.1f, 40f, 60f, 5f}));
        scores.put(score("zero", new float[10]));
        scores.put(score("huge", new float[] {1e9f, 1e9f, 1e9f, 1e9f, 1e9f, 1e9f, 1e9f, 1e9f, 1e9f, 1e9f}));
        scores.put(score("negative", new float[] {-1e9f, -1e9f, -1e9f, -1e9f, -1e9f, -1e9f, -1e9f, -1e9f, -1e9f, -1e9f}));
        float[] nan = {19.4f, 5.5f, 184f, 33.5f, 33f, 678f, 0.43f, Float.NaN, 208f, 37.6f};
        scores.put(score("nan in a weighted feature", nan));
        float[] nanUnweighted = {19.4f, 5.5f, 184f, 33.5f, 33f, 678f, 0.43f, 148f, 208f, 37.6f};
        nanUnweighted[2] = Float.NaN;
        scores.put(score("nan in an unweighted feature", nanUnweighted));
        scores.put(score("infinity", new float[] {Float.POSITIVE_INFINITY, 5.5f, 184f, 33.5f, 33f, 678f, 0.43f, 148f, 208f, 37.6f}));
        Random f = new Random(7);
        for (int i = 0; i < 30; i++) {
            float[] v = new float[10];
            for (int k = 0; k < 10; k++) v[k] = (float) (f.nextGaussian() * 40 + 40);
            scores.put(score("random " + i, v));
        }
        root.put("scores", scores);

        // levels around the thresholds
        JSONArray levels = GoldenSupport.arr();
        for (int s : new int[] {0, 15, 29, 30, 59, 60, 79, 80, 90, 127}) {
            levels.put(GoldenSupport.obj().put("score", s).put("level", (int) HuaweiStressScoreCalculation.calculateLevel(s)));
        }
        root.put("levels", levels);

        JSONArray requests = GoldenSupport.arr();
        float[] twelve = {19.4f, 5.5f, 184f, 33.5f, 33f, 678f, 0.43f, 148f, 208f, 37.6f, 0f, 0f};
        requests.put(automatic("automatic stress on", 1, 47, twelve, 1_700_000_060));
        requests.put(automatic("automatic stress off", 2, 0, null, 0));
        requests.put(automatic("on without features", 1, 47, null, 5));
        requests.put(automatic("eleven features are not sent", 1, 47, Arrays.copyOf(twelve, 11), 5));
        requests.put(automatic("thirteen features are not sent", 1, 47, Arrays.copyOf(twelve, 13), 5));
        requests.put(automatic("score above 127", 1, 200, twelve, -1));
        HuaweiPacket.ParamsProvider pp = PacketsGoldenKit.params();
        requests.put(PacketsGoldenKit.request("open", new HrRriTest.OpenOrClose.Request(pp, (byte) 3)).put("type", 3));
        requests.put(PacketsGoldenKit.request("close", new HrRriTest.OpenOrClose.Request(pp, (byte) 4)).put("type", 4));
        root.put("requests", requests);

        GoldenSupport.write(args[0], "stress.json", root);
    }
}

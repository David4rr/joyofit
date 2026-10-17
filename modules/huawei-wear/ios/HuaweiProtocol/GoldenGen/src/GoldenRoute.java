import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;

import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.utils.HuaweiConvertTrack;
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.utils.HuaweiRouteTrack;
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.utils.HuaweiP2PSubMsg;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The route file of the `fitness` P2P module (business type 6) built by Gadgetbridge's `HuaweiConvertTrack`, on seeded synthetic routes that reach every
 * branch of the simplifier (straight and winding lines, a due-north line, a GPS glitch that skips points, merging when the point limit is small) in
 * both file versions, with and without altitude. Also the handshake body (type 5) and the P2P header around a file.
 */
public class GoldenRoute {
    static final double[] ORIGIN = {-7.9797, 112.6304}; // Malang

    /** A walk of `n` steps of about `stepMeters` that turns by a bounded random angle each step. */
    static double[][] walk(long seed, int n, double stepMeters, double turn, boolean altitude) {
        Random random = new Random(seed);
        double lat = ORIGIN[0], lon = ORIGIN[1], heading = 0.7, alt = 450;
        double[][] points = new double[n][3];
        for (int i = 0; i < n; i++) {
            points[i][0] = lat;
            points[i][1] = lon;
            points[i][2] = altitude ? Math.round((alt + 25 * Math.sin(i / 17.0) + random.nextGaussian()) * 10.0) / 10.0 : 0;
            heading += (random.nextDouble() - 0.5) * turn;
            double step = stepMeters * (0.6 + random.nextDouble() * 0.8);
            lat += Math.cos(heading) * step / 111194.9;
            lon += Math.sin(heading) * step / (111194.9 * Math.cos(Math.toRadians(lat)));
            lat = Math.round(lat * 1e6) / 1e6;
            lon = Math.round(lon * 1e6) / 1e6;
        }
        return points;
    }

    static double[][] line(int n, double dLat, double dLon, boolean altitude) {
        double[][] points = new double[n][3];
        for (int i = 0; i < n; i++) {
            points[i][0] = Math.round((ORIGIN[0] + i * dLat) * 1e6) / 1e6;
            points[i][1] = Math.round((ORIGIN[1] + i * dLon) * 1e6) / 1e6;
            points[i][2] = altitude ? 400 + 3 * i - (i > n / 2 ? 8 * (i - n / 2) : 0) : 0;
        }
        return points;
    }

    /** `walk` with `skip` fixes in the middle replaced by a fix far away in longitude (a GPS glitch), which the converter skips. */
    static double[][] glitch(long seed, int n, int at, int skip) {
        double[][] points = walk(seed, n, 25, 0.8, true);
        for (int i = at; i < at + skip; i++) {
            points[i][1] = points[i][1] + 25.0;
        }
        return points;
    }

    static void add(JSONArray cases, String name, int version, boolean hasAltitude, int maxPoints, long totalTime, double[][] points) {
        List<HuaweiRouteTrack.TrackPoint> list = new ArrayList<>();
        JSONArray input = new JSONArray();
        for (double[] p : points) {
            list.add(new HuaweiRouteTrack.TrackPoint(p[0], p[1], p[2]));
            JSONArray row = new JSONArray();
            row.put(p[0]).put(p[1]).put(p[2]);
            input.put(row);
        }
        HuaweiRouteTrack track = new HuaweiRouteTrack();
        track.setPoints(list);
        track.setHasAltitude(hasAltitude);
        track.setTotalTime(totalTime);
        track.setTrackId("0b8d4c52-5e0a-4f3e-9d27-" + String.format("%012d", points.length));
        track.setTrackName(name);
        track.setVersion(version);
        byte[] file = new HuaweiConvertTrack().convertTrackToBin(track, maxPoints);
        JSONObject c = GoldenSupport.obj();
        c.put("name", name);
        c.put("id", track.getTrackId());
        c.put("version", version);
        c.put("hasAltitude", hasAltitude);
        c.put("maxPoints", maxPoints);
        c.put("totalTime", totalTime);
        c.put("points", input);
        c.put("file", GoldenSupport.hex(file));
        cases.put(c);
    }

    public static void main(String[] args) throws Exception {
        JSONObject root = GoldenSupport.obj();
        JSONArray cases = GoldenSupport.arr();
        add(cases, "Lurus 2 km", 1, false, 200, 0, line(6, 0.0016, 0.0009, false));
        add(cases, "Kota Malang v1", 1, false, 200, 5400, walk(11, 420, 22, 0.9, false));
        add(cases, "Kota Malang v1 tipis", 1, false, 24, 0, walk(11, 420, 22, 0.9, false));
        add(cases, "Bukit v2", 2, true, 200, 3600, walk(21, 380, 30, 0.7, true));
        add(cases, "Bukit v2 tipis", 2, true, 30, 0, walk(21, 380, 30, 0.7, true));
        add(cases, "Datar v2", 2, false, 200, 0, walk(31, 300, 18, 1.2, false));
        add(cases, "Utara v2", 2, false, 200, 0, line(40, 0.0007, 0.0, false));
        add(cases, "Naik turun v2", 2, true, 200, 1800, line(90, 0.0004, 0.0003, true));
        add(cases, "Glitch v2", 2, true, 200, 0, glitch(41, 260, 100, 40));
        root.put("cases", cases);

        // The handshake body: TLV tag 05 = the name, with a varint length (names of 3, 200 UTF-8 bytes to cover the two-byte length).
        JSONArray handshakes = GoldenSupport.arr();
        String[] names = {"Lari pagi", "Rute \u00e9\u00e8 \u5317\u4eac", "x".repeat(200)};
        for (String name : names) {
            HuaweiTLV tlv = new HuaweiTLV();
            tlv.put(5, name);
            JSONObject h = GoldenSupport.obj();
            h.put("name", name);
            h.put("body", GoldenSupport.hex(tlv.serialize()));
            handshakes.put(h);
        }
        root.put("handshakes", handshakes);

        // The header the file travels in (business type 6, message id 4242) around an arbitrary body.
        byte[] body = GoldenSupport.bytes(7, 20);
        JSONObject message = GoldenSupport.obj();
        message.put("type", 6);
        message.put("messageId", 4242);
        message.put("body", GoldenSupport.hex(body));
        message.put("bytes", GoldenSupport.hex(new HuaweiP2PSubMsg(6, 4242, body).getBytes()));
        root.put("message", message);

        GoldenSupport.write(args[0], "route.json", root);
    }
}

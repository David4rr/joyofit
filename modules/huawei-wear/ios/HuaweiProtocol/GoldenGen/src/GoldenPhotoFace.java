import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.PhotoFace;

import org.json.JSONArray;
import org.json.JSONObject;

/** PhotoFace (27/08, 27/09, 28/01 answer, 27/05 ack): the phone-to-watch packets of the photo face, built by the real Java classes. */
public class GoldenPhotoFace {
    public static void main(String[] args) throws Exception {
        JSONObject root = GoldenSupport.obj();
        final HuaweiPacket.ParamsProvider pp = PacketsGoldenKit.params();
        JSONArray requests = GoldenSupport.arr();

        for (boolean[] c : new boolean[][] {{true, true, true}, {false, false, false}, {false, true, false}, {true, false, true}}) {
            JSONObject o = PacketsGoldenKit.request("info " + c[0] + "/" + c[1] + "/" + c[2], new PhotoFace.InfoRequest(pp, c[0], c[1], c[2]));
            o.put("kind", "info").put("position", c[0]).put("style", c[1]).put("data", c[2]);
            requests.put(o);
        }

        HuaweiTLV save = new HuaweiTLV().put(0x01, (byte) 2)
            .put(0x82, new HuaweiTLV().put(0x83, new HuaweiTLV().put(0x04, (byte) 0).put(0x05, "a.png")).put(0x83, new HuaweiTLV().put(0x04, (byte) 1).put(0x05, "b.png")))
            .put(0x06, (byte) 1);
        JSONObject s = PacketsGoldenKit.request("save", new PhotoFace.SaveRequest(pp, save));
        s.put("kind", "save").put("body", GoldenSupport.hex(save.serialize()));
        requests.put(s);

        Object[][] answers = {
            {"x.png", 3, 1, 100000}, {"x.png", 3, -1, 140006}, {"1791994229644.png", 3, 0, 100000}, {"", 0, -1, 0}, {"é.png", 255, 7, -1},
        };
        for (Object[] a : answers) {
            JSONObject o = PacketsGoldenKit.request("answer " + a[0] + " " + a[1] + " " + a[2] + " " + a[3],
                new PhotoFace.FileRequestAnswer(pp, (String) a[0], (Integer) a[1], (Integer) a[2], (Integer) a[3]));
            o.put("kind", "answer").put("name", a[0]).put("fileType", a[1]).put("resourceType", a[2]).put("status", a[3]);
            o.put("label", "answer " + a[0] + " " + a[1] + " " + a[2] + " " + a[3]);
            requests.put(o);
        }
        for (String[] a : new String[][] {{"2180736265", "2.4.11"}, {"1", ""}, {"", ""}}) {
            JSONObject o = PacketsGoldenKit.request("ack " + a[0] + " " + a[1], new PhotoFace.ReportAck(pp, a[0], a[1]));
            o.put("kind", "ack").put("faceId", a[0]).put("version", a[1]);
            requests.put(o);
        }
        root.put("requests", requests);
        GoldenSupport.write(args[0], "packetsPhotoFace.json", root);
    }
}

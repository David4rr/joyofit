import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Watchface;

import org.json.JSONArray;
import org.json.JSONObject;

/** Watchface (service 0x27): the list, operation, confirm and name requests and the watch's answers, from the real Java. */
public class GoldenWatchface {
    static byte[] b(int... v) {
        byte[] out = new byte[v.length];
        for (int i = 0; i < v.length; i++) out[i] = (byte) v[i];
        return out;
    }

    interface Maker {
        HuaweiPacket make() throws Exception;
    }

    static JSONObject request(String name, Maker maker) {
        try {
            return PacketsGoldenKit.request(name, maker.make());
        } catch (Exception e) {
            JSONObject o = GoldenSupport.obj();
            o.put("name", name);
            o.put("ok", false);
            o.put("exception", PacketsGoldenKit.exceptionName(e));
            return o;
        }
    }

    static final PacketsGoldenKit.Dumper PARAMS = (parsed, fields) -> {
        Watchface.WatchfaceDeviceParams p = ((Watchface.WatchfaceParams.Response) parsed).params;
        fields.put("maxVersion", p.maxVersion);
        fields.put("width", p.width);
        fields.put("height", p.height);
        fields.put("supportFileType", (int) p.supportFileType);
        fields.put("sort", (int) p.sort);
        fields.put("otherWatchfaceVersions", p.otherWatchfaceVersions);
        fields.put("supportCapability", p.supportCapability);
        fields.put("supportSync", p.supportSync);
        fields.put("mode", p.mode);
        fields.put("status", p.status);
    };

    static final PacketsGoldenKit.Dumper LIST = (parsed, fields) -> {
        JSONArray a = GoldenSupport.arr();
        for (Watchface.InstalledWatchfaceInfo i : ((Watchface.DeviceWatchInfo.Response) parsed).watchfaceInfoList) {
            a.put(GoldenSupport.obj().put("fileName", i.fileName).put("version", i.version).put("type", (int) i.type).put("expandedType", (int) i.expandedType)
                .put("isCurrent", i.isCurrent()).put("isFactory", i.isFactory()).put("isEditable", i.isEditable()).put("isVideo", i.isVideo())
                .put("isPhoto", i.isPhoto()).put("isTryout", i.isTryout()).put("isKaleidoscope", i.isKaleidoscope()));
        }
        fields.put("list", a);
    };

    static final PacketsGoldenKit.Dumper NAMES = (parsed, fields) -> {
        JSONObject names = GoldenSupport.obj();
        for (Map.Entry<String, String> e : new TreeMap<>(((Watchface.WatchfaceNameInfo.Response) parsed).watchFaceNames).entrySet()) {
            names.put(e.getKey(), e.getValue());
        }
        fields.put("names", names);
    };

    static JSONObject resp(String name, int command, HuaweiTLV tlv, PacketsGoldenKit.Dumper dumper) {
        return PacketsGoldenKit.response(name, 0x27, command, tlv.serialize(), PacketsGoldenKit.params(), dumper);
    }

    static HuaweiTLV face(String file, String version, int type, Integer expanded) {
        HuaweiTLV t = new HuaweiTLV().put(0x03, file).put(0x04, version).put(0x05, (byte) type);
        if (expanded != null) t.put(0x07, (byte) (int) expanded);
        return t;
    }

    public static void main(String[] args) throws Exception {
        JSONObject root = GoldenSupport.obj();
        final HuaweiPacket.ParamsProvider pp = PacketsGoldenKit.params();

        JSONArray requests = GoldenSupport.arr();
        requests.put(request("params", () -> new Watchface.WatchfaceParams.Request(pp)));
        requests.put(request("list", () -> new Watchface.DeviceWatchInfo.Request(pp)));
        for (String name : new String[] {"123456789_2.1.0", "1000_1.0.0", "a_b_c", "_v", "123456789", "123_", "_", "", "a__b"}) {
            for (int op : new int[] {1, 2}) {
                JSONObject o = request("operation " + name + " op " + op, () -> new Watchface.WatchfaceOperation.Request(pp, name, (byte) op));
                o.put("fileName", name).put("operation", op);
                requests.put(o);
            }
        }
        for (String name : new String[] {"123456789_2.1.0", "1000_1.0.0", "a_b_c", "_v", "123456789", "123_", "_", "", "a__b"}) {
            JSONObject o = request("confirm " + name, () -> new Watchface.WatchfaceConfirm.Request(pp, name));
            o.put("fileName", name);
            requests.put(o);
        }
        JSONArray listArg = GoldenSupport.arr();
        {
            List<Watchface.InstalledWatchfaceInfo> faces = new ArrayList<>();
            faces.add(new Watchface.InstalledWatchfaceInfo(face("1000", "1.0.0", 3, null)));
            faces.add(new Watchface.InstalledWatchfaceInfo(face("2000", "1.2.0", 0, 5)));
            JSONObject o = request("names two", () -> new Watchface.WatchfaceNameInfo.Request(pp, faces));
            o.put("faces", GoldenSupport.arr()
                .put(GoldenSupport.obj().put("fileName", "1000").put("version", "1.0.0").put("type", 3).put("expandedType", 0))
                .put(GoldenSupport.obj().put("fileName", "2000").put("version", "1.2.0").put("type", 0).put("expandedType", 5)));
            requests.put(o);
            JSONObject empty = request("names none", () -> new Watchface.WatchfaceNameInfo.Request(pp, new ArrayList<>()));
            empty.put("faces", GoldenSupport.arr());
            requests.put(empty);
        }
        root.put("requests", requests);

        JSONArray responses = GoldenSupport.arr();
        responses.put(resp("params full", 1, new HuaweiTLV().put(0x01, "2.10").put(0x02, 408).put(0x03, 480).put(0x04, (byte) 1).put(0x05, (byte) 0)
            .put(0x06, "2.1,2.2,2.3").put(0x11, 0x3d).put(0x17, (byte) 1).put(0x18, (byte) 0).put(0x7f, 100000), PARAMS));
        responses.put(resp("params minimal", 1, new HuaweiTLV().put(0x01, "2.10").put(0x02, (short) 408).put(0x03, (short) 480).put(0x04, (byte) 1).put(0x05, (byte) 0), PARAMS));
        responses.put(resp("params byte capability", 1, new HuaweiTLV().put(0x01, "2.10").put(0x02, 408).put(0x03, 480).put(0x04, (byte) 0xFF).put(0x05, (byte) 0x80)
            .put(0x11, (byte) 0xC8), PARAMS));
        responses.put(resp("params no width", 1, new HuaweiTLV().put(0x01, "2.10").put(0x03, 480).put(0x04, (byte) 1).put(0x05, (byte) 0), PARAMS));
        responses.put(resp("params empty sort", 1, new HuaweiTLV().put(0x01, "2.10").put(0x02, 408).put(0x03, 480).put(0x04, (byte) 1).put(0x05, new byte[0]), PARAMS));
        responses.put(resp("params three byte width", 1, new HuaweiTLV().put(0x01, "2.10").put(0x02, b(1, 2, 3)).put(0x03, 480).put(0x04, (byte) 1).put(0x05, (byte) 0), PARAMS));
        responses.put(resp("params oversize capability", 1, new HuaweiTLV().put(0x01, "2.10").put(0x02, 408).put(0x03, 480).put(0x04, (byte) 1).put(0x05, (byte) 0)
            .put(0x11, b(1, 2, 3, 4, 5)), PARAMS));

        responses.put(resp("list two", 2, new HuaweiTLV().put(0x81, new HuaweiTLV()
            .put(0x82, face("1000", "1.0.0", 0b11, null)).put(0x82, face("2000", "1.2.0", 0b101001, 7))), LIST));
        responses.put(resp("list flags", 2, new HuaweiTLV().put(0x81, new HuaweiTLV()
            .put(0x82, face("1", "v", 0xFF, null)).put(0x82, face("2", "v", 0x80, 0x80)).put(0x82, face("3", "v", 0x40, null))), LIST));
        responses.put(resp("list without 81", 2, new HuaweiTLV(), LIST));
        responses.put(resp("list empty 81", 2, new HuaweiTLV().put(0x81, new HuaweiTLV()), LIST));
        responses.put(resp("list entry without type", 2, new HuaweiTLV().put(0x81, new HuaweiTLV()
            .put(0x82, new HuaweiTLV().put(0x03, "1").put(0x04, "v"))), LIST));
        responses.put(resp("list entry empty type", 2, new HuaweiTLV().put(0x81, new HuaweiTLV()
            .put(0x82, new HuaweiTLV().put(0x03, "1").put(0x04, "v").put(0x05, new byte[0]))), LIST));
        responses.put(resp("list malformed", 2, new HuaweiTLV().put(0x81, b(0x82, 0x09)), LIST));

        responses.put(resp("operation ok", 3, new HuaweiTLV().put(0x7f, 100000), null));
        responses.put(resp("operation announce answer", 3, new HuaweiTLV().put(0x01, "123").put(0x02, "2.1.0").put(0x04, (byte) 1).put(0x7f, 100000), null));
        responses.put(resp("operation need receive 0", 3, new HuaweiTLV().put(0x01, "123").put(0x02, "2.1.0").put(0x04, (byte) 0), null));
        responses.put(resp("operation signature failure", 3, new HuaweiTLV().put(0x7f, 100014), null));
        responses.put(resp("operation empty", 3, new HuaweiTLV(), null));
        responses.put(resp("operation byte status", 3, new HuaweiTLV().put(0x7f, (byte) 0), null));
        responses.put(resp("operation long status", 3, new HuaweiTLV().put(0x7f, b(1, 2, 3, 4, 5)), null));

        responses.put(resp("confirm installed", 5, new HuaweiTLV().put(0x01, "123456789").put(0x02, "2.1.0").put(0x03, 2), null));
        responses.put(resp("confirm deleted", 5, new HuaweiTLV().put(0x01, "123456789").put(0x02, "2.1.0").put(0x03, 3).put(0x04, (byte) 0), null));
        responses.put(resp("confirm byte type", 5, new HuaweiTLV().put(0x01, "9").put(0x02, "1.0").put(0x03, (byte) 2), null));
        responses.put(resp("confirm without type", 5, new HuaweiTLV().put(0x01, "9").put(0x02, "1.0"), null));
        responses.put(resp("confirm without version", 5, new HuaweiTLV().put(0x01, "9"), null));
        responses.put(resp("confirm without id", 5, new HuaweiTLV().put(0x02, "1.0"), null));
        responses.put(resp("confirm short type", 5, new HuaweiTLV().put(0x01, "9").put(0x02, "1.0").put(0x03, b(1, 2, 3)), null));

        responses.put(resp("names two", 6, new HuaweiTLV().put(0x82, new HuaweiTLV()
            .put(0x83, new HuaweiTLV().put(0x04, "1000").put(0x05, "Factory")).put(0x83, new HuaweiTLV().put(0x04, "2000").put(0x05, "Night Run"))), NAMES));
        responses.put(resp("names duplicate id", 6, new HuaweiTLV().put(0x82, new HuaweiTLV()
            .put(0x83, new HuaweiTLV().put(0x04, "1000").put(0x05, "First")).put(0x83, new HuaweiTLV().put(0x04, "1000").put(0x05, "Second"))), NAMES));
        responses.put(resp("names without 82", 6, new HuaweiTLV(), NAMES));
        responses.put(resp("names empty name", 6, new HuaweiTLV().put(0x82, new HuaweiTLV()
            .put(0x83, new HuaweiTLV().put(0x04, "1000").put(0x05, ""))), NAMES));
        responses.put(resp("names entry without name", 6, new HuaweiTLV().put(0x82, new HuaweiTLV()
            .put(0x83, new HuaweiTLV().put(0x04, "1000"))), NAMES));
        responses.put(resp("names utf8", 6, new HuaweiTLV().put(0x82, new HuaweiTLV()
            .put(0x83, new HuaweiTLV().put(0x04, "7").put(0x05, "夜跑"))), NAMES));
        root.put("responses", responses);

        GoldenSupport.write(args[0], "packetsWatchface.json", root);
    }
}

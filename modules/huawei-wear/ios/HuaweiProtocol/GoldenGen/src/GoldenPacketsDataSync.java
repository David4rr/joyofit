import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.DataSync;
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.datasync.HuaweiDataSyncCommon;

import org.json.JSONArray;
import org.json.JSONObject;

/** DataSync (service 0x37) config command: the find-device requests and the watch's answers, built and parsed by the real Java classes. */
public class GoldenPacketsDataSync {
    static byte[] b(int... v) {
        byte[] out = new byte[v.length];
        for (int i = 0; i < v.length; i++) out[i] = (byte) v[i];
        return out;
    }

    static HuaweiDataSyncCommon.ConfigData config(int id, int action, byte[] data, long unknown) {
        HuaweiDataSyncCommon.ConfigData c = new HuaweiDataSyncCommon.ConfigData();
        c.configId = id;
        c.configAction = (byte) action;
        c.configData = data;
        c.configUnknown = unknown;
        return c;
    }

    static final PacketsGoldenKit.Dumper CONFIG_DUMPER = (parsed, fields) -> {
        DataSync.ConfigCommand.Response r = (DataSync.ConfigCommand.Response) parsed;
        fields.put("srcPackage", r.srcPackage);
        fields.put("dstPackage", r.dstPackage);
        fields.put("code", r.data.getCode());
        JSONArray list = GoldenSupport.arr();
        if (r.data.getConfigDataList() != null) {
            for (HuaweiDataSyncCommon.ConfigData c : r.data.getConfigDataList()) {
                list.put(GoldenSupport.obj()
                    .put("configId", c.configId)
                    .put("configAction", (int) c.configAction)
                    .put("configData", c.configData == null ? JSONObject.NULL : GoldenSupport.hex(c.configData))
                    .put("configUnknown", c.configUnknown));
            }
        }
        fields.put("configs", list);
    };

    static JSONObject configRequest(String name, String src, String dst, HuaweiDataSyncCommon.ConfigData... items) throws Exception {
        HuaweiDataSyncCommon.ConfigCommandData data = new HuaweiDataSyncCommon.ConfigCommandData();
        data.setConfigDataList(java.util.Arrays.asList(items));
        JSONObject o = PacketsGoldenKit.request(name, new DataSync.ConfigCommand.Request(PacketsGoldenKit.params(), src, dst, data));
        o.put("src", src);
        o.put("dst", dst);
        JSONArray list = GoldenSupport.arr();
        for (HuaweiDataSyncCommon.ConfigData c : items) {
            list.put(GoldenSupport.obj()
                .put("configId", c.configId)
                .put("configAction", (int) c.configAction)
                .put("configData", c.configData == null ? JSONObject.NULL : GoldenSupport.hex(c.configData))
                .put("configUnknown", c.configUnknown));
        }
        o.put("items", list);
        return o;
    }

    static JSONObject configResponse(String name, HuaweiTLV tlv) {
        return PacketsGoldenKit.response(name, 0x37, 0x01, tlv.serialize(), PacketsGoldenKit.params(), CONFIG_DUMPER);
    }

    static JSONObject configResponse(String name, byte[] tlv) {
        return PacketsGoldenKit.response(name, 0x37, 0x01, tlv, PacketsGoldenKit.params(), CONFIG_DUMPER);
    }

    public static void main(String[] args) throws Exception {
        JSONObject root = GoldenSupport.obj();
        final String SRC = "hw.unitedevice.finddevice";
        final String DST = "findDevice";

        JSONArray requests = GoldenSupport.arr();
        // Find my watch: config id 900100002, action 2 = start, 1 = stop.
        requests.put(configRequest("find start", SRC, DST, config(900100002, 2, null, -1)));
        requests.put(configRequest("find stop", SRC, DST, config(900100002, 1, null, -1)));
        requests.put(configRequest("no items", SRC, DST));
        requests.put(configRequest("data and unknown", "a.b", "c", config(7, 3, b(1, 2, 3), 99L)));
        requests.put(configRequest("two items, one without id", "a.b", "c", config(-1, 5, b(0xFF), -1), config(0x7FFFFFFF, 0x7F, new byte[0], 1L << 40)));
        requests.put(configRequest("empty package names", "", ""));
        root.put("requests", requests);

        JSONArray responses = GoldenSupport.arr();
        HuaweiTLV head = new HuaweiTLV().put(0x01, DST).put(0x02, SRC);
        responses.put(configResponse("ok no items", head));
        responses.put(configResponse("ok one item", new HuaweiTLV().put(0x01, DST).put(0x02, SRC).put(0x83, new HuaweiTLV()
            .put(0x84, new HuaweiTLV().put(0x05, 900100002).put(0x06, (byte) 2)))));
        responses.put(configResponse("ok full item", new HuaweiTLV().put(0x01, DST).put(0x02, SRC).put(0x83, new HuaweiTLV()
            .put(0x84, new HuaweiTLV().put(0x05, 5).put(0x06, (byte) 1).put(0x07, b(9, 8, 7)).put(0x08, 123456789012L))
            .put(0x84, new HuaweiTLV().put(0x05, 6)))));
        responses.put(configResponse("error code 7f", new HuaweiTLV().put(0x01, DST).put(0x02, SRC).put(0x7F, 100001)));
        responses.put(configResponse("explicit ok code", new HuaweiTLV().put(0x01, DST).put(0x02, SRC).put(0x7F, 100000)));
        responses.put(configResponse("error code with items is not parsed", new HuaweiTLV().put(0x01, DST).put(0x02, SRC).put(0x7F, 5)
            .put(0x83, new HuaweiTLV().put(0x84, new HuaweiTLV().put(0x05, 1)))));
        responses.put(configResponse("no src", new HuaweiTLV().put(0x02, SRC)));
        responses.put(configResponse("no dst", new HuaweiTLV().put(0x01, DST)));
        responses.put(configResponse("short code", new HuaweiTLV().put(0x01, DST).put(0x02, SRC).put(0x7F, b(1, 2))));
        responses.put(configResponse("empty 83", new HuaweiTLV().put(0x01, DST).put(0x02, SRC).put(0x83, new HuaweiTLV())));
        responses.put(configResponse("short id", new HuaweiTLV().put(0x01, DST).put(0x02, SRC).put(0x83, new HuaweiTLV()
            .put(0x84, new HuaweiTLV().put(0x05, b(1, 2))))));
        responses.put(configResponse("malformed 83", new HuaweiTLV().put(0x01, DST).put(0x02, SRC).put(0x83, b(0x84, 0x09))));
        root.put("responses", responses);

        GoldenSupport.write(args[0], "packetsDataSync.json", root);
    }
}

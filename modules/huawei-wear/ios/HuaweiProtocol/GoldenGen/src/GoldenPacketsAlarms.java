import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Alarms;

import org.json.JSONArray;
import org.json.JSONObject;

/** Alarms (service 0x08): the event/smart alarm requests and the list answers, built and parsed by the real Java classes. */
public class GoldenPacketsAlarms {
    static byte[] b(int... v) {
        byte[] out = new byte[v.length];
        for (int i = 0; i < v.length; i++) out[i] = (byte) v[i];
        return out;
    }

    static JSONObject eventJson(Alarms.EventAlarm a) {
        return GoldenSupport.obj()
            .put("index", (int) a.index).put("status", a.status).put("startHour", (int) a.startHour)
            .put("startMinute", (int) a.startMinute).put("repeat", (int) a.repeat).put("name", a.name);
    }

    static JSONObject smartJson(Alarms.SmartAlarm a) {
        return GoldenSupport.obj()
            .put("index", (int) a.index).put("status", a.status).put("startHour", (int) a.startHour)
            .put("startMinute", (int) a.startMinute).put("repeat", (int) a.repeat).put("aheadTime", (int) a.aheadTime);
    }

    static JSONObject eventRequest(String name, Alarms.EventAlarm... alarms) throws Exception {
        Alarms.EventAlarmsRequest request = new Alarms.EventAlarmsRequest(PacketsGoldenKit.params());
        JSONArray list = GoldenSupport.arr();
        for (Alarms.EventAlarm a : alarms) {
            request.addEventAlarm(a);
            list.put(eventJson(a));
        }
        JSONObject o = PacketsGoldenKit.request(name, request);
        o.put("alarms", list);
        return o;
    }

    static JSONObject smartRequest(String name, Alarms.SmartAlarm alarm) throws Exception {
        JSONObject o = PacketsGoldenKit.request(name, new Alarms.SmartAlarmRequest(PacketsGoldenKit.params(), alarm));
        o.put("alarm", smartJson(alarm));
        return o;
    }

    static HuaweiTLV event(int index, Boolean status, Integer time, Integer repeat, String name) {
        HuaweiTLV t = new HuaweiTLV().put(0x03, (byte) index);
        if (status != null) t.put(0x04, status.booleanValue());
        if (time != null) t.put(0x05, (short) time.intValue());
        if (repeat != null) t.put(0x06, (byte) repeat.intValue());
        if (name != null) t.put(0x07, name);
        return t;
    }

    static final PacketsGoldenKit.Dumper EVENT_LIST = (parsed, fields) -> {
        Alarms.EventAlarmsList.Response r = (Alarms.EventAlarmsList.Response) parsed;
        JSONArray list = GoldenSupport.arr();
        for (Alarms.EventAlarm a : r.eventAlarms) list.put(eventJson(a));
        fields.put("eventAlarms", list);
    };

    static final PacketsGoldenKit.Dumper SMART_LIST = (parsed, fields) -> {
        Alarms.SmartAlarmList.Response r = (Alarms.SmartAlarmList.Response) parsed;
        fields.put("smartAlarm", r.smartAlarm == null ? JSONObject.NULL : smartJson(r.smartAlarm));
    };

    static JSONObject eventResponse(String name, HuaweiTLV tlv) {
        return PacketsGoldenKit.response(name, 0x08, 0x03, tlv.serialize(), PacketsGoldenKit.params(), EVENT_LIST);
    }

    static JSONObject eventResponse(String name, byte[] tlv) {
        return PacketsGoldenKit.response(name, 0x08, 0x03, tlv, PacketsGoldenKit.params(), EVENT_LIST);
    }

    static JSONObject smartResponse(String name, HuaweiTLV tlv) {
        return PacketsGoldenKit.response(name, 0x08, 0x04, tlv.serialize(), PacketsGoldenKit.params(), SMART_LIST);
    }

    static JSONObject smartResponse(String name, byte[] tlv) {
        return PacketsGoldenKit.response(name, 0x08, 0x04, tlv, PacketsGoldenKit.params(), SMART_LIST);
    }

    public static void main(String[] args) throws Exception {
        JSONObject root = GoldenSupport.obj();

        JSONArray requests = GoldenSupport.arr();
        requests.put(eventRequest("event none clears with bare index 1"));
        requests.put(eventRequest("event one", new Alarms.EventAlarm((byte) 1, true, (byte) 7, (byte) 30, (byte) 0x1F, "Work")));
        requests.put(eventRequest("event five", new Alarms.EventAlarm((byte) 1, true, (byte) 6, (byte) 0, (byte) 0x7F, "A"),
            new Alarms.EventAlarm((byte) 2, false, (byte) 23, (byte) 59, (byte) 0, ""),
            new Alarms.EventAlarm((byte) 3, true, (byte) 12, (byte) 5, (byte) 0x41, "Lunch"),
            new Alarms.EventAlarm((byte) 4, false, (byte) 0, (byte) 0, (byte) 1, "Midnight"),
            new Alarms.EventAlarm((byte) 5, true, (byte) 18, (byte) 45, (byte) 0x60, "Weekend \u00e9\u4e2d")));
        requests.put(eventRequest("event minute above 127 and hour sign", new Alarms.EventAlarm((byte) 2, true, (byte) 23, (byte) 200, (byte) 3, "x")));
        requests.put(eventRequest("event out of range bytes", new Alarms.EventAlarm((byte) 9, true, (byte) 200, (byte) 70, (byte) 0xFF, "Out")));
        requests.put(smartRequest("smart on", new Alarms.SmartAlarm(true, (byte) 6, (byte) 45, (byte) 0x7F, (byte) 10)));
        requests.put(smartRequest("smart off", new Alarms.SmartAlarm(false, (byte) 0, (byte) 0, (byte) 0, (byte) 5)));
        requests.put(smartRequest("smart minute above 127", new Alarms.SmartAlarm(true, (byte) 23, (byte) 200, (byte) 1, (byte) 127)));
        requests.put(PacketsGoldenKit.request("event list", new Alarms.EventAlarmsList.Request(PacketsGoldenKit.params())));
        requests.put(PacketsGoldenKit.request("smart list", new Alarms.SmartAlarmList.Request(PacketsGoldenKit.params())));
        root.put("requests", requests);

        JSONArray responses = GoldenSupport.arr();
        responses.put(eventResponse("event two alarms", new HuaweiTLV().put(0x81, new HuaweiTLV()
            .put(0x82, event(1, true, 0x071E, 0x1F, "Work"))
            .put(0x82, event(2, false, 0x1702, 0, "")))));
        responses.put(eventResponse("event disabled without time", new HuaweiTLV().put(0x81, new HuaweiTLV()
            .put(0x82, event(3, null, null, null, null)))));
        responses.put(eventResponse("event disabled with explicit false", new HuaweiTLV().put(0x81, new HuaweiTLV()
            .put(0x82, event(4, false, null, 5, "Off")))));
        responses.put(eventResponse("event enabled without time", new HuaweiTLV().put(0x81, new HuaweiTLV()
            .put(0x82, event(1, true, null, 1, "x")))));
        responses.put(eventResponse("event time with high minute", new HuaweiTLV().put(0x81, new HuaweiTLV()
            .put(0x82, event(5, true, 0x17C8, 0x7F, "Late")))));
        responses.put(eventResponse("event negative time", new HuaweiTLV().put(0x81, new HuaweiTLV()
            .put(0x82, event(1, false, 0xFFFF, 0, "neg")))));
        responses.put(eventResponse("event unicode name", new HuaweiTLV().put(0x81, new HuaweiTLV()
            .put(0x82, event(2, true, 0x0800, 0x60, "Weekend \u00e9\u4e2d")))));
        responses.put(eventResponse("event empty 81", new HuaweiTLV().put(0x81, new HuaweiTLV())));
        responses.put(eventResponse("event no 81", new HuaweiTLV().put(0x01, (byte) 1)));
        responses.put(eventResponse("event entry without index", new HuaweiTLV().put(0x81, new HuaweiTLV()
            .put(0x82, new HuaweiTLV().put(0x04, true)))));
        responses.put(eventResponse("event short time", new HuaweiTLV().put(0x81, new HuaweiTLV()
            .put(0x82, new HuaweiTLV().put(0x03, (byte) 1).put(0x04, true).put(0x05, b(7))))));
        responses.put(eventResponse("event long boolean", new HuaweiTLV().put(0x81, new HuaweiTLV()
            .put(0x82, new HuaweiTLV().put(0x03, (byte) 1).put(0x04, b(1, 1))))));
        responses.put(eventResponse("event malformed 81", new HuaweiTLV().put(0x81, b(0x82, 0x09))));
        root.put("eventResponses", responses);

        JSONArray smart = GoldenSupport.arr();
        smart.put(smartResponse("smart present", new HuaweiTLV().put(0x81, new HuaweiTLV().put(0x82, new HuaweiTLV()
            .put(0x03, (byte) 1).put(0x04, true).put(0x05, (short) 0x062D).put(0x06, (byte) 0x7F).put(0x07, (byte) 10)))));
        smart.put(smartResponse("smart minimal", new HuaweiTLV().put(0x81, new HuaweiTLV().put(0x82, new HuaweiTLV().put(0x03, (byte) 1)))));
        smart.put(smartResponse("smart none", new HuaweiTLV().put(0x81, new HuaweiTLV())));
        smart.put(smartResponse("smart no 81", new HuaweiTLV().put(0x01, (byte) 1)));
        smart.put(smartResponse("smart without index", new HuaweiTLV().put(0x81, new HuaweiTLV().put(0x82, new HuaweiTLV().put(0x04, true)))));
        smart.put(smartResponse("smart high minute", new HuaweiTLV().put(0x81, new HuaweiTLV().put(0x82, new HuaweiTLV()
            .put(0x03, (byte) 1).put(0x05, (short) 0x17C8).put(0x07, (byte) 0xFF)))));
        smart.put(smartResponse("smart bad sized fields use defaults", new HuaweiTLV().put(0x81, new HuaweiTLV().put(0x82, new HuaweiTLV()
            .put(0x03, (byte) 1).put(0x04, b(1, 1)).put(0x05, b(7)).put(0x06, b(1, 2)).put(0x07, b(1, 2))))));
        root.put("smartResponses", smart);

        GoldenSupport.write(args[0], "packetsAlarms.json", root);
    }
}

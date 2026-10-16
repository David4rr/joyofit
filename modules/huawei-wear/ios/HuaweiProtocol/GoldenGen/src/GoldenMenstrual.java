import java.time.LocalDate;
import java.time.ZoneOffset;

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Menstrual;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Menstrual calendar (service 0x32): the phone's packets as MenstrualCodec.kt builds them (same HuaweiTLV calls, same inputs) inside the real
 * Menstrual.Message / CapabilityRequest, with encryption off. The Swift test feeds the same inputs through MenstrualCodec / CycleModel and
 * compares TLV and frames byte for byte. Days are UTC midnights.
 */
public class GoldenMenstrual {
    private static int secs(String day) {
        return (int) LocalDate.parse(day).atStartOfDay(ZoneOffset.UTC).toEpochSecond();
    }

    private static int secsOrZero(String day) {
        return day == null ? 0 : secs(day);
    }

    private static JSONObject message(String name, int command, HuaweiTLV body) throws Exception {
        return PacketsGoldenKit.request(name, new Menstrual.Message(PacketsGoldenKit.params(), (byte) command, body));
    }

    /** start, end, fertileStart, fertileEnd, length, logged: what CycleModel.entries(1, 1) yields for the MenstrualTest periods on 2026-10-14. */
    private static final Object[][] ENTRIES = {
        {"2026-08-26", "2026-08-30", null, null, 28, true},
        {"2026-09-23", "2026-09-27", "2026-10-02", "2026-10-08", 28, true},
        {"2026-10-21", "2026-10-25", "2026-10-30", "2026-11-05", 28, false},
    };

    /** keyDays(30, 30) of the same model. */
    private static final Object[][] KEY_DAYS = {
        {"2026-09-23", 101}, {"2026-09-27", 102}, {"2026-10-02", 401}, {"2026-10-07", 403}, {"2026-10-08", 402},
        {"2026-10-21", 301}, {"2026-10-25", 302}, {"2026-10-30", 401}, {"2026-11-04", 403}, {"2026-11-05", 402},
    };

    private static HuaweiTLV cycleList(boolean tag0a, boolean tag0b, boolean tag0c, int modified, int avgCycle, int avgPeriod, int finished, int future) {
        HuaweiTLV list = new HuaweiTLV();
        for (Object[] e : ENTRIES) {
            HuaweiTLV item = new HuaweiTLV()
                .put(0x04, secs((String) e[0]))
                .put(0x05, secsOrZero((String) e[1]))
                .put(0x06, secsOrZero((String) e[2]))
                .put(0x07, secsOrZero((String) e[3]))
                .put(0x08, (byte) (int) (Integer) e[4]);
            if (tag0c) item.put(0x12, (byte) ((Boolean) e[5] ? 1 : 0));
            list.put(0x83, item);
        }
        HuaweiTLV out = new HuaweiTLV()
            .put(0x01, new byte[] {(byte) finished, (byte) future})
            .put(0x82, list)
            .put(0x09, modified);
        if (tag0b) out.put(0x0A, (byte) avgCycle);
        if (tag0a) out.put(0x0B, (byte) avgPeriod);
        return out;
    }

    private static HuaweiTLV bodyStatusFrame(int index, int size) {
        int from = index * size;
        int to = Math.min(KEY_DAYS.length, from + size);
        HuaweiTLV items = new HuaweiTLV();
        for (int i = from; i < to; i++) {
            items.put(0x84, new HuaweiTLV()
                .put(0x05, secs((String) KEY_DAYS[i][0]))
                .put(0x06, (short) (int) (Integer) KEY_DAYS[i][1])
                .put(0x08, (short) 0)
                .put(0x09, (short) 0));
        }
        return new HuaweiTLV().put(0x01, (byte) index).put(0x02, (byte) (to - from)).put(0x83, items);
    }

    public static void main(String[] args) throws Exception {
        JSONObject root = GoldenSupport.obj();
        JSONArray cases = GoldenSupport.arr();

        cases.put(message("switches 0b00001011", 0x01, new HuaweiTLV().put(0x01, (byte) 0x0B)).put("kind", "switches").put("bitfield", 0x0B));
        cases.put(message("switches 0b111111", 0x01, new HuaweiTLV().put(0x01, (byte) 0x3F)).put("kind", "switches").put("bitfield", 0x3F));
        cases.put(message("capability dictionary", 0x05, new HuaweiTLV().put(0x01, (byte) 3)).put("kind", "capability").put("dictionary", true));
        cases.put(message("capability classic", 0x05, new HuaweiTLV().put(0x01, (byte) 2)).put("kind", "capability").put("dictionary", false));
        cases.put(message("update notice", 0x04, new HuaweiTLV()).put("kind", "updateNotice"));
        cases.put(message("no data", 0x02, new HuaweiTLV().put(0x7F, 150001)).put("kind", "noData"));
        cases.put(message("modify time", 0x02, new HuaweiTLV().put(0x01, (int) 0x69C6C0C0L)).put("kind", "modifyTime").put("modified", 0x69C6C0C0L));
        cases.put(message("cycle list all flags", 0x03, cycleList(true, true, true, 1791936000, 28, 5, 1, 1))
            .put("kind", "cycleList").put("tag0a", true).put("tag0b", true).put("tag0c", true).put("modified", 1791936000L));
        cases.put(message("cycle list no flags", 0x03, cycleList(false, false, false, 5, 28, 5, 1, 1))
            .put("kind", "cycleList").put("tag0a", false).put("tag0b", false).put("tag0c", false).put("modified", 5L));
        cases.put(message("cycle list only 0b", 0x03, cycleList(false, true, false, 77, 28, 5, 1, 1))
            .put("kind", "cycleList").put("tag0a", false).put("tag0b", true).put("tag0c", false).put("modified", 77L));
        cases.put(message("frame count 3", 0x06, new HuaweiTLV().put(0x04, (byte) 3)).put("kind", "frameCount").put("count", 3));
        for (int index : new int[] {0, 3}) {
            cases.put(message("body status frame " + index, 0x07, bodyStatusFrame(index, 3)).put("kind", "bodyStatus").put("index", index).put("size", 3));
        }
        root.put("messages", cases);

        JSONObject capability = PacketsGoldenKit.request("CapabilityRequest", new Menstrual.CapabilityRequest(PacketsGoldenKit.params()));
        root.put("capabilityRequest", capability);
        GoldenSupport.write(args[0], "menstrual.json", root);
    }
}

import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV;

import org.json.JSONArray;
import org.json.JSONObject;

/** Shared by GoldenPackets*.java: dumping requests the way the wire sees them and running the real Java response parsers. */
final class PacketsGoldenKit {
    private PacketsGoldenKit() {}

    static HuaweiPacket.ParamsProvider params() {
        HuaweiPacket.ParamsProvider pp = new HuaweiPacket.ParamsProvider();
        pp.setTransactionsCrypted(false);
        return pp;
    }

    /** A bare packet used to build a frame around a hand-made TLV. */
    static class Raw extends HuaweiPacket {
        Raw(HuaweiPacket.ParamsProvider pp, int sid, int cid, byte[] tlvBytes) {
            super(pp);
            this.serviceId = (byte) sid;
            this.commandId = (byte) cid;
            this.tlv = new HuaweiTLV().parse(tlvBytes);
            this.isEncrypted = false;
            this.isSliced = false;
            this.complete = true;
        }
    }

    static boolean flag(HuaweiPacket p, String field) {
        try {
            Field f = HuaweiPacket.class.getDeclaredField(field);
            f.setAccessible(true);
            return f.getBoolean(p);
        } catch (ReflectiveOperationException e) {
            throw new RuntimeException(e);
        }
    }

    static JSONArray entries(HuaweiTLV tlv) {
        JSONArray a = GoldenSupport.arr();
        for (HuaweiTLV.TLV e : tlv.get()) {
            a.put(GoldenSupport.obj().put("tag", e.getTag() & 0xFF).put("value", GoldenSupport.hex(e.getValue())));
        }
        return a;
    }

    /** A request: header ids, the Java flags, the TLV after serialize() (SupportedCommands wraps itself there) and the frames with encryption off. */
    static JSONObject request(String name, HuaweiPacket p) throws Exception {
        List<byte[]> frames = p.serialize();
        JSONObject o = GoldenSupport.obj();
        o.put("name", name);
        o.put("service", p.serviceId & 0xFF);
        o.put("command", p.commandId & 0xFF);
        o.put("encrypted", flag(p, "isEncrypted"));
        o.put("sliced", flag(p, "isSliced"));
        o.put("tlv", GoldenSupport.hex(p.getTlv().serialize()));
        JSONArray fa = GoldenSupport.arr();
        for (byte[] f : frames) fa.put(GoldenSupport.hex(f));
        o.put("frames", fa);
        return o;
    }

    static String exceptionName(Throwable e) {
        Class<?> c = e.getClass();
        while (c.isAnonymousClass()) c = c.getSuperclass();
        return c.getSimpleName();
    }

    interface Dumper {
        void dump(HuaweiPacket parsed, JSONObject fields) throws Exception;
    }

    /** Frames `tlv` as service/command, lets the real HuaweiPacket.parse pick the response class and runs parseTlv(). */
    static JSONObject response(String name, int service, int command, byte[] tlv, HuaweiPacket.ParamsProvider pp, Dumper dumper) {
        JSONObject o = GoldenSupport.obj();
        o.put("name", name);
        o.put("service", service);
        o.put("command", command);
        o.put("tlv", GoldenSupport.hex(tlv));
        try {
            byte[] frame = new Raw(pp, service, command, tlv).serialize().get(0);
            HuaweiPacket parsed = new HuaweiPacket(pp).parse(frame);
            parsed.parseTlv();
            JSONObject fields = GoldenSupport.obj();
            if (dumper != null) dumper.dump(parsed, fields);
            else reflect(parsed, fields);
            o.put("ok", true);
            o.put("fields", fields);
        } catch (Exception e) {
            o.put("ok", false);
            o.put("exception", exceptionName(e));
            o.put("parseException", e instanceof HuaweiPacket.ParseException);
        }
        return o;
    }

    static JSONObject response(String name, int service, int command, byte[] tlv) {
        return response(name, service, command, tlv, params(), null);
    }

    static JSONObject response(String name, int service, int command, HuaweiTLV tlv) {
        return response(name, service, command, tlv.serialize());
    }

    /** Every public instance field declared on the response class: bytes and shorts as signed numbers, byte[] as hex. */
    static void reflect(Object parsed, JSONObject out) throws Exception {
        for (Field f : parsed.getClass().getDeclaredFields()) {
            if (!Modifier.isPublic(f.getModifiers()) || Modifier.isStatic(f.getModifiers())) continue;
            Object v = f.get(parsed);
            if (v == null) out.put(f.getName(), JSONObject.NULL);
            else if (v instanceof byte[]) out.put(f.getName(), GoldenSupport.hex((byte[]) v));
            else if (v instanceof Byte) out.put(f.getName(), ((Byte) v).intValue());
            else if (v instanceof Short) out.put(f.getName(), ((Short) v).intValue());
            else if (v instanceof Integer || v instanceof Long || v instanceof Boolean || v instanceof String) out.put(f.getName(), v);
            else throw new IllegalStateException("unhandled field " + f.getName() + " of " + parsed.getClass());
        }
    }

    static byte[] ascii(String s) {
        return s.getBytes(StandardCharsets.US_ASCII);
    }

    static byte[] cat(byte[]... parts) {
        int n = 0;
        for (byte[] p : parts) n += p.length;
        byte[] out = new byte[n];
        int o = 0;
        for (byte[] p : parts) {
            System.arraycopy(p, 0, out, o, p.length);
            o += p.length;
        }
        return out;
    }

    static List<Object> list() {
        return new ArrayList<>();
    }
}

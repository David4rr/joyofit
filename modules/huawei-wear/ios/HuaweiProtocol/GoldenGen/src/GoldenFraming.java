import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV;

import org.json.JSONArray;
import org.json.JSONObject;

/** Packet serialization (slicing, CRC16, TLV encryption) and reassembly, through HuaweiPacket.java. */
public class GoldenFraming {
    static class PP extends HuaweiPacket.ParamsProvider {
        long counter() { return encryptionCounter; }
    }

    static class P extends HuaweiPacket {
        P(HuaweiPacket.ParamsProvider pp, int sid, int cid, HuaweiTLV tlv, boolean encrypted, boolean sliced) {
            super(pp);
            this.serviceId = (byte) sid;
            this.commandId = (byte) cid;
            this.tlv = tlv;
            this.isEncrypted = encrypted;
            this.isSliced = sliced;
            this.complete = true;
        }
    }

    static JSONObject entries(HuaweiTLV tlv) {
        JSONObject o = GoldenSupport.obj();
        if (tlv == null) {
            o.put("tlv", JSONObject.NULL);
            return o;
        }
        JSONArray a = GoldenSupport.arr();
        for (HuaweiTLV.TLV e : tlv.get()) {
            a.put(GoldenSupport.obj().put("tag", e.getTag() & 0xFF).put("value", GoldenSupport.hex(e.getValue())));
        }
        o.put("tlv", a);
        return o;
    }

    static PP params(int sliceSize, int encryptMethod, int deviceSupportType, byte[] key, long counter, boolean crypted) {
        PP pp = new PP();
        pp.setSliceSize(sliceSize);
        pp.setEncryptMethod((byte) encryptMethod);
        pp.setDeviceSupportType((byte) deviceSupportType);
        pp.setSecretKey(key);
        pp.setEncryptionCounter(counter);
        pp.setTransactionsCrypted(crypted);
        return pp;
    }

    /** The Kotlin HuaweiSession.onData loop, recording every completed packet or the error that dropped a chunk. */
    static JSONArray feed(HuaweiPacket.ParamsProvider pp, List<byte[]> chunks) {
        JSONArray out = GoldenSupport.arr();
        HuaweiPacket received = null;
        for (byte[] chunk : chunks) {
            byte[] data = chunk;
            int left = 0;
            do {
                if (left > 0) data = Arrays.copyOfRange(data, data.length - left, data.length);
                HuaweiPacket packet;
                try {
                    packet = received == null ? new HuaweiPacket(pp).parse(data) : received.parse(data);
                } catch (Exception e) {
                    out.put(GoldenSupport.obj().put("error", e.getClass().getSimpleName()));
                    received = null;
                    break;
                }
                received = packet;
                left = packet.getLeft();
                if (packet.complete) {
                    JSONObject o = entries(packet.getTlv());
                    o.put("service", packet.serviceId & 0xFF);
                    o.put("command", packet.commandId & 0xFF);
                    out.put(o);
                    received = null;
                }
            } while (left > 0);
        }
        return out;
    }

    static List<byte[]> split(byte[] all, int size) {
        List<byte[]> chunks = new ArrayList<>();
        for (int i = 0; i < all.length; i += size) chunks.add(Arrays.copyOfRange(all, i, Math.min(all.length, i + size)));
        return chunks;
    }

    static byte[] concat(List<byte[]> frames) {
        int n = 0;
        for (byte[] f : frames) n += f.length;
        byte[] out = new byte[n];
        int p = 0;
        for (byte[] f : frames) {
            System.arraycopy(f, 0, out, p, f.length);
            p += f.length;
        }
        return out;
    }

    public static void main(String[] args) throws Exception {
        JSONObject root = GoldenSupport.obj();
        JSONArray serialize = GoldenSupport.arr();
        JSONArray parse = GoldenSupport.arr();

        byte[] key16 = GoldenSupport.bytes(2000, 16);
        byte[] key32 = GoldenSupport.bytes(2001, 32);

        // name, sliceSize, bodyBytes, encrypted, sliced, encryptMethod, deviceSupportType, key, counter, transactionsCrypted
        Object[][] cases = {
            {"empty tlv unsliced", 0xf4, 0, false, false, 0, 1, null, 0L, true},
            {"small unsliced", 0xf4, 10, false, false, 0, 1, null, 0L, true},
            {"small sliced flag, one frame", 0xf4, 10, false, true, 0, 1, null, 0L, true},
            {"fits exactly one slice", 0xf4, 0xf4 - 7 - 2, false, true, 0, 1, null, 0L, true},
            {"one byte over one slice", 0xf4, 0xf4 - 7 - 2 + 1, false, true, 0, 1, null, 0L, true},
            {"two slices", 0xf4, 300, false, true, 0, 1, null, 0L, true},
            {"three slices", 0xf4, 600, false, true, 0, 1, null, 0L, true},
            {"many slices", 0xf4, 5000, false, true, 0, 1, null, 0L, true},
            {"1022 slice size, 1 frame", 1022, 900, false, true, 0, 1, null, 0L, true},
            {"1022 slice size, 2 slices", 1022, 1500, false, true, 0, 1, null, 0L, true},
            {"slice size 20", 20, 200, false, true, 0, 1, null, 0L, true},
            {"cbc encrypted small", 0xf4, 20, true, true, 0, 1, key16, 41L, true},
            {"cbc encrypted sliced", 0xf4, 700, true, true, 0, 1, key16, 0xFFFFFFFEL, true},
            {"gcm encrypted small", 0xf4, 33, true, true, 1, 1, key32, 7L, true},
            {"gcm encrypted sliced", 1022, 2500, true, true, 1, 1, key16, 0L, true},
            {"deviceSupportType 4 gcm", 0xf4, 50, true, true, 0, 4, key16, 0L, true},
            {"encrypted but transactions not crypted", 0xf4, 50, true, true, 0, 1, key16, 0L, false},
        };
        for (int i = 0; i < cases.length; i++) {
            Object[] c = cases[i];
            String name = (String) c[0];
            int sliceSize = (Integer) c[1];
            int body = (Integer) c[2];
            boolean enc = (Boolean) c[3];
            boolean sliced = (Boolean) c[4];
            int method = (Integer) c[5];
            int dst = (Integer) c[6];
            byte[] key = (byte[]) c[7];
            long counter = (Long) c[8];
            boolean crypted = (Boolean) c[9];

            HuaweiTLV tlv = new HuaweiTLV();
            if (body > 0) {
                // A mix of tag/value pairs: 4 bytes of overhead each so the body ends up exactly `body` bytes long.
                int remaining = body;
                int n = 0;
                while (remaining > 0) {
                    int valueLen = Math.min(remaining - 2, 40 + (n % 5) * 17);
                    if (valueLen < 0) valueLen = 0;
                    if (remaining - (2 + valueLen) < 0) valueLen = Math.max(0, remaining - 2);
                    tlv.put(0x01 + n % 7, GoldenSupport.bytes(3000 + i * 100 + n, valueLen));
                    remaining -= 2 + valueLen;
                    n++;
                    if (remaining == 1) {
                        // a trailing byte that cannot hold a tag and a length: absorb it into the last value
                        tlv = new HuaweiTLV();
                        tlv.put(0x05, GoldenSupport.bytes(3000 + i, body - 2));
                        remaining = 0;
                    }
                }
            }
            PP pp = params(sliceSize, method, dst, key, counter, crypted);
            P packet = new P(pp, 0x01 + (i % 40), 0x03 + i, tlv, enc, sliced);
            List<byte[]> frames = packet.serialize();

            JSONObject o = GoldenSupport.obj();
            o.put("name", name);
            o.put("sliceSize", sliceSize);
            o.put("service", packet.serviceId & 0xFF);
            o.put("command", packet.commandId & 0xFF);
            o.put("encrypted", enc);
            o.put("sliced", sliced);
            o.put("encryptMethod", method);
            o.put("deviceSupportType", dst);
            o.put("transactionsCrypted", crypted);
            o.put("key", key == null ? JSONObject.NULL : GoldenSupport.hex(key));
            o.put("counterBefore", counter);
            o.put("counterAfter", pp.counter());
            o.put("tlv", GoldenSupport.hex(tlv.serialize()));
            JSONArray fa = GoldenSupport.arr();
            for (byte[] f : frames) fa.put(GoldenSupport.hex(f));
            o.put("frames", fa);

            // The IV Java drew is visible in the clear in the wire TLV; Swift pins its entropy to it.
            if (enc && crypted) {
                PP clear = params(sliceSize, method, dst, null, 0, true);
                JSONArray parsed = feed(clear, frames);
                JSONObject first = parsed.getJSONObject(0);
                for (Object e : first.getJSONArray("tlv")) {
                    JSONObject eo = (JSONObject) e;
                    if (eo.getInt("tag") == 125) o.put("iv", eo.getString("value"));
                }
            }
            serialize.put(o);

            // Reassembly of the same frames with the receiver's key: whole frames, one stream, and 1/7/20-byte chunks.
            byte[] stream = concat(frames);
            JSONObject p = GoldenSupport.obj();
            p.put("name", name);
            p.put("sliceSize", sliceSize);
            p.put("encryptMethod", method);
            p.put("deviceSupportType", dst);
            p.put("key", key == null ? JSONObject.NULL : GoldenSupport.hex(key));
            p.put("stream", GoldenSupport.hex(stream));
            JSONObject variants = GoldenSupport.obj();
            variants.put("frames", feed(params(sliceSize, method, dst, key, 0, true), frames));
            variants.put("stream", feed(params(sliceSize, method, dst, key, 0, true), List.of(stream)));
            for (int size : new int[] {1, 7, 20}) {
                variants.put("chunks" + size, feed(params(sliceSize, method, dst, key, 0, true), split(stream, size)));
            }
            p.put("results", variants);
            parse.put(p);
        }

        // Two packets back to back, then a packet whose tail arrives with the next one.
        {
            PP pp = params(0xf4, 0, 1, null, 0, true);
            byte[] a = new P(pp, 0x07, 0x0a, new HuaweiTLV().put(0x01, (byte) 1), false, false).serialize().get(0);
            byte[] b = new P(pp, 0x07, 0x0c, new HuaweiTLV().put(0x02, (short) 5), false, false).serialize().get(0);
            byte[] ab = concat(List.of(a, b));
            JSONObject p = GoldenSupport.obj();
            p.put("name", "two frames in one chunk; a frame split across chunks");
            p.put("stream", GoldenSupport.hex(ab));
            JSONObject variants = GoldenSupport.obj();
            variants.put("stream", feed(params(0xf4, 0, 1, null, 0, true), List.of(ab)));
            variants.put("splitInsideSecond", feed(params(0xf4, 0, 1, null, 0, true), List.of(Arrays.copyOfRange(ab, 0, a.length + 3), Arrays.copyOfRange(ab, a.length + 3, ab.length))));
            variants.put("splitAtHeader", feed(params(0xf4, 0, 1, null, 0, true), List.of(Arrays.copyOfRange(ab, 0, 2), Arrays.copyOfRange(ab, 2, ab.length))));
            p.put("results", variants);
            parse.put(p);
        }

        // Malformed input and the raw-payload services (0x0a/0x05 carries file data, not TLV).
        JSONArray bad = GoldenSupport.arr();
        {
            PP pp = params(0xf4, 0, 1, null, 0, true);
            byte[] good = new P(pp, 0x07, 0x0a, new HuaweiTLV().put(0x01, (byte) 1), false, false).serialize().get(0);
            byte[] badCrc = good.clone();
            badCrc[badCrc.length - 1] ^= 0x01;
            byte[] badMagic = good.clone();
            badMagic[0] = 0x5B;
            byte[] negLen = good.clone();
            negLen[1] = (byte) 0x80;
            byte[] fileData = new byte[] {0x5A, 0x00, 0x07, 0x00, 0x0A, 0x05, 0x01, 0x02, 0x03, 0x04, 0x00, 0x00};
            int crc = nodomain.freeyourgadget.gadgetbridge.util.CheckSums.getCRC16(Arrays.copyOfRange(fileData, 0, 10), 0);
            fileData[10] = (byte) (crc >> 8);
            fileData[11] = (byte) crc;
            byte[][] inputs = {good, badCrc, badMagic, negLen, fileData, new byte[] {0x5A}, new byte[] {0x5A, 0x00}};
            String[] names = {"good", "bad crc", "bad magic", "negative length", "file data payload service 0a/05", "magic only", "magic and half a length"};
            for (int i = 0; i < inputs.length; i++) {
                JSONObject o = GoldenSupport.obj();
                o.put("name", names[i]);
                o.put("input", GoldenSupport.hex(inputs[i]));
                JSONArray r = feed(params(0xf4, 0, 1, null, 0, true), List.of(inputs[i]));
                o.put("result", r);
                // raw payload packets expose `payload`; Java keeps it protected, so the expected value is the body incl. service and command
                if (i == 4) o.put("payload", GoldenSupport.hex(Arrays.copyOfRange(fileData, 4, 10)));
                bad.put(o);
            }
        }
        root.put("serialize", serialize);
        root.put("parse", parse);
        root.put("malformed", bad);
        GoldenSupport.write(args[0], "framing.json", root);
    }
}

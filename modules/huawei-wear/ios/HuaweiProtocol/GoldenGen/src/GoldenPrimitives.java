import static nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiCrypto.*;

import java.nio.ByteBuffer;

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiCrypto;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV;
import nodomain.freeyourgadget.gadgetbridge.util.CheckSums;
import nodomain.freeyourgadget.gadgetbridge.util.CryptoUtils;

import org.json.JSONArray;
import org.json.JSONObject;

/** crc16, sha256, hmac, hkdf, pbkdf2, aes-cbc, aes-gcm, HuaweiCrypto digests and keys, TLV encode/decode: all through the Java classes the Android app runs. */
public class GoldenPrimitives {
    public static void main(String[] args) throws Exception {
        JSONObject root = GoldenSupport.obj();

        JSONArray crc = GoldenSupport.arr();
        int[] crcLengths = {0, 1, 9, 17, 100, 300};
        for (int i = 0; i < crcLengths.length; i++) {
            byte[] data = i == 2 ? "123456789".getBytes() : GoldenSupport.bytes(100 + i, crcLengths[i]);
            JSONObject o = GoldenSupport.obj();
            o.put("data", GoldenSupport.hex(data));
            o.put("init0", CheckSums.getCRC16(data, 0x0000));
            o.put("initFFFF", CheckSums.getCRC16(data, 0xFFFF));
            crc.put(o);
        }
        root.put("crc16", crc);

        JSONArray sha = GoldenSupport.arr();
        for (int len : new int[] {0, 1, 3, 55, 56, 63, 64, 65, 119, 120, 1000}) {
            byte[] data = GoldenSupport.bytes(200 + len, len);
            JSONObject o = GoldenSupport.obj();
            o.put("data", GoldenSupport.hex(data));
            o.put("digest", GoldenSupport.hex(CryptoUtils.digest(data)));
            sha.put(o);
        }
        root.put("sha256", sha);

        JSONArray hmac = GoldenSupport.arr();
        int[][] hmacCases = {{1, 0}, {16, 16}, {16, 100}, {32, 7}, {63, 64}, {64, 64}, {65, 10}, {100, 300}};
        for (int[] c : hmacCases) {
            byte[] key = GoldenSupport.bytes(300 + c[0], c[0]);
            byte[] msg = GoldenSupport.bytes(400 + c[1], c[1]);
            JSONObject o = GoldenSupport.obj();
            o.put("key", GoldenSupport.hex(key));
            o.put("message", GoldenSupport.hex(msg));
            o.put("mac", GoldenSupport.hex(CryptoUtils.calcHmacSha256(key, msg)));
            hmac.put(o);
        }
        root.put("hmacSha256", hmac);

        JSONArray hkdf = GoldenSupport.arr();
        int[][] hkdfCases = {{16, 32, 22, 32}, {32, 32, 22, 32}, {32, 0, 0, 16}, {32, 16, 5, 80}, {16, 32, 3, 64}, {32, 32, 22, 100}};
        for (int[] c : hkdfCases) {
            byte[] secret = GoldenSupport.bytes(500 + c[0], c[0]);
            byte[] salt = c[1] == 0 ? new byte[] {0x01} : GoldenSupport.bytes(600 + c[1], c[1]);
            byte[] info = c[2] == 22 ? "hichain_iso_session_key".getBytes() : GoldenSupport.bytes(700 + c[2], c[2]);
            JSONObject o = GoldenSupport.obj();
            o.put("secretKey", GoldenSupport.hex(secret));
            o.put("salt", GoldenSupport.hex(salt));
            o.put("info", GoldenSupport.hex(info));
            o.put("length", c[3]);
            o.put("okm", GoldenSupport.hex(CryptoUtils.hkdfSha256(secret, salt, info, c[3])));
            hkdf.put(o);
        }
        root.put("hkdfSha256", hkdf);

        JSONArray pbkdf2 = GoldenSupport.arr();
        String[][] pbkdfCases = {{"password", "salt"}, {"0A1B2C3D4E5F60718293A4B5C6D7E8F9AABB", "00112233445566778899AABBCCDDEEFF"}};
        for (String[] c : pbkdfCases) {
            JSONObject o = GoldenSupport.obj();
            o.put("key", c[0]);
            o.put("iv", c[1]);
            o.put("count", 1000);
            o.put("bits", 256);
            o.put("derived", GoldenSupport.hex(CryptoUtils.pbkdf2Sha256(c[0], c[1], 1000, 256)));
            pbkdf2.put(o);
        }
        root.put("pbkdf2Sha256", pbkdf2);

        JSONArray cbc = GoldenSupport.arr();
        int[] cbcLengths = {0, 1, 15, 16, 17, 31, 32, 100, 513};
        for (int i = 0; i < cbcLengths.length; i++) {
            byte[] key = GoldenSupport.bytes(800 + i, i % 3 == 2 ? 32 : 16);
            byte[] iv = GoldenSupport.bytes(900 + i, 16);
            byte[] data = GoldenSupport.bytes(1000 + i, cbcLengths[i]);
            JSONObject o = GoldenSupport.obj();
            o.put("key", GoldenSupport.hex(key));
            o.put("iv", GoldenSupport.hex(iv));
            o.put("plain", GoldenSupport.hex(data));
            o.put("cipher", GoldenSupport.hex(CryptoUtils.encryptAES_CBC_Pad(data, key, iv)));
            cbc.put(o);
        }
        root.put("aesCbc", cbc);

        JSONArray gcm = GoldenSupport.arr();
        // {key length, iv length, aad length (-1 = none), data length}
        int[][] gcmCases = {
            {16, 12, -1, 0}, {16, 12, -1, 1}, {16, 12, -1, 16}, {16, 12, 20, 17}, {32, 12, 22, 16}, {32, 12, 20, 64},
            {16, 16, -1, 0}, {16, 16, -1, 100}, {32, 16, -1, 33}, {32, 16, 22, 100}, {16, 16, 5, 513}, {32, 8, -1, 10}, {16, 13, 3, 40}
        };
        for (int i = 0; i < gcmCases.length; i++) {
            int[] c = gcmCases[i];
            byte[] key = GoldenSupport.bytes(1100 + i, c[0]);
            byte[] iv = GoldenSupport.bytes(1200 + i, c[1]);
            byte[] aad = c[2] < 0 ? null : GoldenSupport.bytes(1300 + i, c[2]);
            byte[] data = GoldenSupport.bytes(1400 + i, c[3]);
            JSONObject o = GoldenSupport.obj();
            o.put("key", GoldenSupport.hex(key));
            o.put("iv", GoldenSupport.hex(iv));
            o.put("aad", aad == null ? JSONObject.NULL : GoldenSupport.hex(aad));
            o.put("plain", GoldenSupport.hex(data));
            o.put("cipher", GoldenSupport.hex(CryptoUtils.encryptAES_GCM_NoPad(data, key, iv, aad)));
            gcm.put(o);
        }
        root.put("aesGcm", gcm);

        // HuaweiCrypto
        JSONArray secretKeys = GoldenSupport.arr();
        for (int version : new int[] {1, 2, 3}) {
            for (String mac : new String[] {"30:A9:98:FC:64:0A", "FF:FF:FF:12:ab:cd"}) {
                JSONObject o = GoldenSupport.obj();
                o.put("authVersion", version);
                o.put("mac", mac);
                o.put("key", GoldenSupport.hex(new HuaweiCrypto(version).createSecretKey(mac)));
                secretKeys.put(o);
            }
        }
        root.put("createSecretKey", secretKeys);

        JSONArray digests = GoldenSupport.arr();
        byte[] nonce = GoldenSupport.bytes(1500, 32);
        byte[] secret = GoldenSupport.bytes(1501, 16);
        // {authVersion, authAlgo, deviceSupportType, authMode, hasKey}
        int[][] digestCases = {
            {1, 0, 1, 0, 0}, {2, 0, 1, 0, 0}, {3, 0, 3, 0, 0}, {4, 0, 4, 0, 0},
            {1, 0, 2, 2, 1}, {1, 1, 2, 2, 1}, {2, 0, 2, 2, 1}, {3, 0, 2, 2, 1}, {3, 1, 2, 2, 1}, {1, 0, 2, 2, 0}
        };
        for (int[] c : digestCases) {
            HuaweiCrypto crypto = new HuaweiCrypto(c[0], (byte) c[1], c[2], (byte) c[3]);
            byte[] key = c[4] == 1 ? secret : null;
            JSONObject o = GoldenSupport.obj();
            o.put("authVersion", c[0]);
            o.put("authAlgo", c[1]);
            o.put("deviceSupportType", c[2]);
            o.put("authMode", c[3]);
            o.put("key", key == null ? JSONObject.NULL : GoldenSupport.hex(key));
            o.put("nonce", GoldenSupport.hex(nonce));
            byte[] challenge = crypto.digestChallenge(key, nonce);
            byte[] response = crypto.digestResponse(key, nonce);
            o.put("challenge", challenge == null ? JSONObject.NULL : GoldenSupport.hex(challenge));
            o.put("response", response == null ? JSONObject.NULL : GoldenSupport.hex(response));
            digests.put(o);
        }
        root.put("digests", digests);

        JSONArray ivs = GoldenSupport.arr();
        for (long counter : new long[] {0L, 1L, 0x7FFFFFFFL, 0xFFFFFFFEL, 0xFFFFFFFFL}) {
            JSONObject o = GoldenSupport.obj();
            o.put("counter", counter);
            ByteBuffer iv = HuaweiCrypto.initializationVector(counter);
            o.put("lastFour", GoldenSupport.hex(new byte[] {iv.array()[12], iv.array()[13], iv.array()[14], iv.array()[15]}));
            o.put("next", (long) iv.getInt(12) & 0xFFFFFFFFL);
            ivs.put(o);
        }
        root.put("initializationVector", ivs);

        JSONArray bonding = GoldenSupport.arr();
        for (int method : new int[] {0, 1}) {
            byte[] key = GoldenSupport.bytes(1600, 16);
            byte[] iv = GoldenSupport.bytes(1601, 16);
            byte[] data = GoldenSupport.bytes(1602, 16);
            JSONObject o = GoldenSupport.obj();
            o.put("encryptMethod", method);
            o.put("key", GoldenSupport.hex(key));
            o.put("iv", GoldenSupport.hex(iv));
            o.put("data", GoldenSupport.hex(data));
            o.put("encrypted", GoldenSupport.hex(new HuaweiCrypto(1).encryptBondingKey((byte) method, data, key, iv)));
            bonding.put(o);
        }
        root.put("bondingKey", bonding);

        // TLV
        JSONArray tlv = GoldenSupport.arr();
        {
            HuaweiTLV t = new HuaweiTLV()
                .put(0x01)
                .put(0x02, (byte) 0x7f)
                .put(0x03, (byte) 0xff)
                .put(0x04, true)
                .put(0x05, (short) 0x1234)
                .put(0x06, 0x01020304)
                .put(0x07, 0x0102030405060708L)
                .put(0x08, "héllo")
                .put(0x09, new byte[127])
                .put(0x0a, new byte[128])
                .put(0x0b, new byte[16383])
                .put(0x0c, new byte[16384])
                .put(0x0d, 1.5d)
                .put(0x81, new HuaweiTLV().put(0x01, (byte) 1).put(0x82, new HuaweiTLV().put(0x02, (short) 7)))
                .put(0xff, new byte[] {1, 2, 3});
            JSONObject o = GoldenSupport.obj();
            o.put("serialized", GoldenSupport.hex(t.serialize()));
            o.put("length", t.length());
            tlv.put(o);
        }
        root.put("tlvBuild", tlv);

        // Parse vectors: serialized hex, then the entries Java parses (tag/value hex). Includes a trailing null byte and a nested container.
        JSONArray tlvParse = GoldenSupport.arr();
        String[] parseInputs = {
            "010100020203e8",
            "8105" + "0101" + "00" + "8200",
            "0100" + "00",
            "0481" + "00" + "00",
            "05" + "8001" + "aa",
        };
        for (String in : parseInputs) {
            JSONObject o = GoldenSupport.obj();
            o.put("input", in);
            try {
                HuaweiTLV t = new HuaweiTLV().parse(GoldenSupport.unhex(in));
                JSONArray entries = GoldenSupport.arr();
                for (HuaweiTLV.TLV e : t.get()) {
                    JSONObject eo = GoldenSupport.obj();
                    eo.put("tag", e.getTag() & 0xFF);
                    eo.put("value", GoldenSupport.hex(e.getValue()));
                    entries.put(eo);
                }
                o.put("entries", entries);
            } catch (RuntimeException e) {
                o.put("error", e.getClass().getSimpleName());
            }
            tlvParse.put(o);
        }
        root.put("tlvParse", tlvParse);

        GoldenSupport.write(args[0], "primitives.json", root);
    }
}

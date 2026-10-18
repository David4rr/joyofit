import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.FileDownloadService0A;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.FileDownloadService2C;
import nodomain.freeyourgadget.gadgetbridge.util.CheckSums;

import org.json.JSONArray;
import org.json.JSONObject;

/** The file download packets (FileDownloadService2C.java / FileDownloadService0A.java): requests as built, responses as parsed. */
public class GoldenSleepPackets {
    static class PP extends HuaweiPacket.ParamsProvider {}

    static class P extends HuaweiPacket {
        P(HuaweiPacket.ParamsProvider pp, int sid, int cid, HuaweiTLV tlv) {
            super(pp);
            this.serviceId = (byte) sid;
            this.commandId = (byte) cid;
            this.tlv = tlv;
            this.isEncrypted = false;
            this.complete = true;
        }
    }

    static final byte[] KEY = GoldenSupport.bytes(5100, 16);

    static PP params(int sliceSize, int encryptMethod, int deviceSupportType, byte[] key, boolean crypted) {
        PP pp = new PP();
        pp.setSliceSize(sliceSize);
        pp.setEncryptMethod((byte) encryptMethod);
        pp.setDeviceSupportType((byte) deviceSupportType);
        pp.setSecretKey(key);
        pp.setTransactionsCrypted(crypted);
        return pp;
    }

    static JSONArray entries(HuaweiTLV tlv) {
        JSONArray a = GoldenSupport.arr();
        for (HuaweiTLV.TLV e : tlv.get()) {
            a.put(GoldenSupport.obj().put("tag", e.getTag() & 0xFF).put("value", GoldenSupport.hex(e.getValue())));
        }
        return a;
    }

    static JSONArray frames(HuaweiPacket p, HuaweiPacket.ParamsProvider pp) throws Exception {
        JSONArray fa = GoldenSupport.arr();
        for (byte[] f : p.serialize()) fa.put(GoldenSupport.hex(f));
        return fa;
    }

    /** The unsliced wire frame of a packet whose body is not TLV (0x0a/0x05, 0x2c/0x05): magic, length, 0, service, command, body, CRC16. */
    static byte[] rawFrame(int sid, int cid, byte[] body) {
        int bodyLength = 2 + body.length;
        byte[] f = new byte[1 + 2 + 1 + bodyLength + 2];
        f[0] = 0x5A;
        f[1] = (byte) ((bodyLength + 1) >> 8);
        f[2] = (byte) (bodyLength + 1);
        f[3] = 0;
        f[4] = (byte) sid;
        f[5] = (byte) cid;
        System.arraycopy(body, 0, f, 6, body.length);
        byte[] head = java.util.Arrays.copyOfRange(f, 0, f.length - 2);
        int crc = CheckSums.getCRC16(head, 0);
        f[f.length - 2] = (byte) (crc >> 8);
        f[f.length - 1] = (byte) crc;
        return f;
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

    static byte[] be32(int v) {
        return new byte[] {(byte) (v >> 24), (byte) (v >> 16), (byte) (v >> 8), (byte) v};
    }

    // ---- requests

    static final Pattern FLAGS = Pattern.compile("isEncrypted=(true|false), isSliced=(true|false)");
    static final JSONArray requests = GoldenSupport.arr();

    static void request(String name, java.util.concurrent.Callable<HuaweiPacket> make) {
        JSONObject o = GoldenSupport.obj();
        o.put("name", name);
        try {
            HuaweiPacket p = make.call();
            Matcher m = FLAGS.matcher(p.toString());
            if (!m.find()) throw new IllegalStateException("flags not found in " + p);
            o.put("service", p.serviceId & 0xFF);
            o.put("command", p.commandId & 0xFF);
            o.put("encrypted", Boolean.parseBoolean(m.group(1)));
            o.put("sliced", Boolean.parseBoolean(m.group(2)));
            o.put("complete", p.complete);
            o.put("tlv", p.getTlv() == null ? JSONObject.NULL : entries(p.getTlv()));
            // plain frames at the default slice size, and a small slice size that shows whether slicing is on
            o.put("frames", frames(p, params(0xf4, 0, 1, null, false)));
        } catch (Exception e) {
            o.put("error", e.getClass().getSimpleName());
        }
        requests.put(o);
    }

    static void requests() {
        PP pp = params(0xf4, 0, 1, KEY, false); // frames are compared in the clear; the flags tell whether the TLV would be encrypted
        FileDownloadService2C.FileType[] types = {
            FileDownloadService2C.FileType.SLEEP_STATE, FileDownloadService2C.FileType.SLEEP_DATA, FileDownloadService2C.FileType.RRI,
            FileDownloadService2C.FileType.GPS, FileDownloadService2C.FileType.PDR, FileDownloadService2C.FileType.SEQUENCE_DATA,
            FileDownloadService2C.FileType.ECG_ANALYSIS_DATA, FileDownloadService2C.FileType.UNKNOWN};
        for (FileDownloadService2C.FileType t : types) {
            request("2C init " + t, () -> new FileDownloadService2C.FileDownloadInit.Request(pp, "file_" + t + ".bin", t, 1700000000, 1700086400, 0));
            request("2C init " + t + " dict", () -> new FileDownloadService2C.FileDownloadInit.Request(pp, "file_" + t, t, -5, 7, 700013));
        }
        request("2C init long name sliced", () -> new FileDownloadService2C.FileDownloadInit.Request(pp, "x".repeat(400), FileDownloadService2C.FileType.SLEEP_DATA, 1, 2, 0));
        request("2C init negative dict", () -> new FileDownloadService2C.FileDownloadInit.Request(pp, "sequence_data", FileDownloadService2C.FileType.SEQUENCE_DATA, 1, 2, -1));
        request("2C hash", () -> new FileDownloadService2C.FileRequestHash.Request(pp, (byte) 0x85));
        request("2C info", () -> new FileDownloadService2C.FileInfo.Request(pp, (byte) 0x16));
        request("2C info 0xff", () -> new FileDownloadService2C.FileInfo.Request(pp, (byte) 0xff));
        request("2C block", () -> new FileDownloadService2C.RequestBlock(pp, (byte) 5, 0, 4096, false, 0));
        request("2C block noEncrypt", () -> new FileDownloadService2C.RequestBlock(pp, (byte) 5, 4096, 1000, true, 0));
        request("2C block dict, file id 0x16", () -> new FileDownloadService2C.RequestBlock(pp, (byte) 0x16, 8192, 100, false, 700013));
        request("2C block dict, file id 5 (no dict sent)", () -> new FileDownloadService2C.RequestBlock(pp, (byte) 5, 8192, 100, false, 700013));
        request("2C block dict, file id 0x16, noEncrypt", () -> new FileDownloadService2C.RequestBlock(pp, (byte) 0x16, -1, -2, true, 1));
        request("2C complete ok", () -> new FileDownloadService2C.FileDownloadCompleteRequest(pp, (byte) 7, (byte) 1));
        request("2C complete failed", () -> new FileDownloadService2C.FileDownloadCompleteRequest(pp, (byte) 0x80, (byte) 2));
        request("2C incoming init with packages", () -> new FileDownloadService2C.IncomingInitRequest.Request(pp, "a.bin", (byte) 0x10, (byte) 3, 99, "src.pkg", "dst.pkg", "srcfp", "dstfp", (byte) 1));
        request("2C incoming init without packages", () -> new FileDownloadService2C.IncomingInitRequest.Request(pp, "a.bin", (byte) 0x10, (byte) 3, 99, null, null, null, null, (byte) 0));
        request("2C incoming init packages, null fingerprints", () -> new FileDownloadService2C.IncomingInitRequest.Request(pp, "a.bin", (byte) 0x10, (byte) 3, 99, "s", "d", null, null, (byte) 0));
        request("2C incoming init only src", () -> new FileDownloadService2C.IncomingInitRequest.Request(pp, "a.bin", (byte) 0x10, (byte) 3, 99, "s", null, "x", "y", (byte) 0));

        request("0A init debug", () -> new FileDownloadService0A.FileDownloadInit.DebugFilesRequest(pp));
        request("0A init sleep", () -> new FileDownloadService0A.FileDownloadInit.SleepFilesRequest(pp, 1700000000, 1700086400));
        request("0A init sleep negative", () -> new FileDownloadService0A.FileDownloadInit.SleepFilesRequest(pp, -1, 0));
        request("0A init gps", () -> new FileDownloadService0A.FileDownloadInit.GpsFileRequest(pp, (short) 0x1234));
        request("0A init gps negative", () -> new FileDownloadService0A.FileDownloadInit.GpsFileRequest(pp, (short) -2));
        request("0A init rri", () -> new FileDownloadService0A.FileDownloadInit.RriFileRequest(pp, 1700000000, 1700086400));
        for (int type : new int[] {0, 1, 2, 4, 0x7f, 0xff}) {
            request("0A parameters " + type, () -> new FileDownloadService0A.FileParameters.Request(pp, (byte) type));
        }
        request("0A info", () -> new FileDownloadService0A.FileInfo.Request(pp, "sleep_state.bin"));
        request("0A info long name sliced", () -> new FileDownloadService0A.FileInfo.Request(pp, "y".repeat(300)));
        request("0A block", () -> new FileDownloadService0A.RequestBlock.Request(pp, "sleep_data.bin", 0, 1024));
        request("0A block offset", () -> new FileDownloadService0A.RequestBlock.Request(pp, "sleep_data.bin", 65536, 100000));
        request("0A complete", () -> new FileDownloadService0A.FileDownloadCompleteRequest(pp));
    }

    // ---- responses

    static final JSONArray responses = GoldenSupport.arr();

    /** Wire frame of `tlv`, parsed by HuaweiPacket.parse into its typed Response, then `parseTlv()`; `describe` dumps the fields. */
    interface Describe {
        void fields(HuaweiPacket response, JSONObject out) throws Exception;
    }

    static void response(String name, int sid, int cid, HuaweiTLV tlv, Describe describe) {
        JSONObject o = GoldenSupport.obj();
        o.put("name", name);
        o.put("service", sid);
        o.put("command", cid);
        PP pp = params(0xf4, 0, 1, null, true);
        byte[] frame;
        try {
            frame = new P(pp, sid, cid, tlv).serialize().get(0);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }
        o.put("frame", GoldenSupport.hex(frame));
        o.put("tlv", entries(tlv));
        o.put("result", resultOf(frame, pp, describe));
        responses.put(o);
    }

    static JSONObject resultOf(byte[] frame, PP pp, Describe describe) {
        JSONObject r = GoldenSupport.obj();
        try {
            HuaweiPacket parsed = new HuaweiPacket(pp).parse(frame);
            parsed.parseTlv();
            describe.fields(parsed, r);
        } catch (Exception e) {
            r = GoldenSupport.obj().put("error", e.getClass().getSimpleName());
        }
        return r;
    }

    static void init2C(String name, HuaweiTLV tlv) {
        response(name, 0x2c, 0x01, tlv, (p, out) -> {
            FileDownloadService2C.FileDownloadInit.Response r = (FileDownloadService2C.FileDownloadInit.Response) p;
            out.put("fileName", r.fileName).put("fileType", r.fileType.name()).put("fileId", r.fileId & 0xFF).put("fileSize", r.fileSize);
        });
    }

    static void hash2C(String name, HuaweiTLV tlv) {
        response(name, 0x2c, 0x02, tlv, (p, out) -> {
            FileDownloadService2C.FileRequestHash.Response r = (FileDownloadService2C.FileRequestHash.Response) p;
            out.put("fileId", r.fileId & 0xFF).put("fileHash", GoldenSupport.hex(r.fileHash));
        });
    }

    static void info2C(String name, HuaweiTLV tlv) {
        response(name, 0x2c, 0x03, tlv, (p, out) -> {
            FileDownloadService2C.FileInfo.Response r = (FileDownloadService2C.FileInfo.Response) p;
            out.put("fileId", r.fileId & 0xFF).put("timeout", r.timeout & 0xFF).put("burstSize", (int) r.burstSize)
                    .put("maxBlockSize", r.maxBlockSize).put("noEncrypt", r.noEncrypt);
        });
    }

    static void incoming2C(String name, HuaweiTLV tlv) {
        response(name, 0x2c, 0x07, tlv, (p, out) -> {
            FileDownloadService2C.IncomingInitRequest.Response r = (FileDownloadService2C.IncomingInitRequest.Response) p;
            out.put("filename", r.filename).put("fileType", r.fileType & 0xFF).put("fileId", r.fileId & 0xFF).put("fileSize", r.fileSize)
                    .put("description", r.description).put("srcPackage", r.srcPackage).put("dstPackage", r.dstPackage)
                    .put("srcFingerprint", r.srcFingerprint == null ? JSONObject.NULL : r.srcFingerprint)
                    .put("dstFingerprint", r.dstFingerprint == null ? JSONObject.NULL : r.dstFingerprint);
        });
    }

    static void init0A(String name, HuaweiTLV tlv) {
        response(name, 0x0a, 0x01, tlv, (p, out) -> {
            FileDownloadService0A.FileDownloadInit.Response r = (FileDownloadService0A.FileDownloadInit.Response) p;
            JSONArray names = GoldenSupport.arr();
            for (String s : r.fileNames) names.put(s);
            out.put("fileNames", names);
        });
    }

    static void parameters0A(String name, HuaweiTLV tlv) {
        response(name, 0x0a, 0x02, tlv, (p, out) -> {
            FileDownloadService0A.FileParameters.Response r = (FileDownloadService0A.FileParameters.Response) p;
            out.put("version", r.version).put("unknown", r.unknown).put("packetSize", (int) r.packetSize)
                    .put("maxBlockSize", (int) r.maxBlockSize).put("timeout", (int) r.timeout);
        });
    }

    static void info0A(String name, HuaweiTLV tlv) {
        response(name, 0x0a, 0x03, tlv, (p, out) -> {
            FileDownloadService0A.FileInfo.Response r = (FileDownloadService0A.FileInfo.Response) p;
            out.put("fileLength", r.fileLength).put("transferType", (int) r.transferType).put("fileCreateTime", r.fileCreateTime)
                    .put("unknown", (int) r.unknown);
        });
    }

    static void block0A(String name, HuaweiTLV tlv) {
        response(name, 0x0a, 0x04, tlv, (p, out) -> {
            FileDownloadService0A.RequestBlock.Response r = (FileDownloadService0A.RequestBlock.Response) p;
            out.put("isOk", r.isOk).put("filename", r.filename == null ? JSONObject.NULL : r.filename).put("offset", r.offset);
        });
    }

    static byte[] bytes(int... v) {
        byte[] b = new byte[v.length];
        for (int i = 0; i < v.length; i++) b[i] = (byte) v[i];
        return b;
    }

    static void responses() {
        init2C("2C init ok", new HuaweiTLV().put(0x01, "sequence_data").put(0x02, (byte) 0x16).put(0x03, (byte) 0x05).put(0x04, 1234));
        init2C("2C init size -1", new HuaweiTLV().put(0x01, "sequence_data").put(0x02, (byte) 0x16).put(0x03, (byte) 0x05).put(0x04, bytes(0xff, 0xff, 0xff, 0xff)));
        init2C("2C init unknown type", new HuaweiTLV().put(0x01, "a").put(0x02, (byte) 0x99).put(0x03, (byte) 0x05).put(0x04, 5));
        init2C("2C init negative type byte", new HuaweiTLV().put(0x01, "a").put(0x02, (byte) 0xff).put(0x03, (byte) 0xff).put(0x04, 5));
        init2C("2C init sleep state", new HuaweiTLV().put(0x01, "sleep_state.bin").put(0x02, (byte) 0x0e).put(0x03, (byte) 0x85).put(0x04, 32));
        init2C("2C init missing id", new HuaweiTLV().put(0x01, "a").put(0x02, (byte) 0x16).put(0x04, 5));
        init2C("2C init missing name", new HuaweiTLV().put(0x02, (byte) 0x16).put(0x03, (byte) 1).put(0x04, 5));
        init2C("2C init size 3 bytes", new HuaweiTLV().put(0x01, "a").put(0x02, (byte) 0x16).put(0x03, (byte) 1).put(0x04, bytes(1, 2, 3)));
        init2C("2C init size 5 bytes", new HuaweiTLV().put(0x01, "a").put(0x02, (byte) 0x16).put(0x03, (byte) 1).put(0x04, bytes(0, 0, 1, 0, 9)));
        init2C("2C init empty type", new HuaweiTLV().put(0x01, "a").put(0x02, new byte[0]).put(0x03, (byte) 1).put(0x04, 5));
        init2C("2C init extra tags", new HuaweiTLV().put(0x7f, 0x186a0).put(0x01, "a").put(0x02, (byte) 0x0f).put(0x03, (byte) 1).put(0x04, 5).put(0x05, (byte) 9));
        init2C("2C init first of repeated tags", new HuaweiTLV().put(0x01, "a").put(0x01, "b").put(0x02, (byte) 0x0f).put(0x03, (byte) 1).put(0x04, 5));

        hash2C("2C hash ok", new HuaweiTLV().put(0x01, (byte) 0x85).put(0x03, GoldenSupport.bytes(5200, 32)));
        hash2C("2C hash missing hash", new HuaweiTLV().put(0x01, (byte) 0x85));
        hash2C("2C hash empty hash", new HuaweiTLV().put(0x01, (byte) 0x85).put(0x03, new byte[0]));

        info2C("2C info ok", new HuaweiTLV().put(0x01, (byte) 0x85).put(0x02, (byte) 10).put(0x03, (short) 1000).put(0x04, 65536).put(0x05, false));
        info2C("2C info noEncrypt", new HuaweiTLV().put(0x01, (byte) 0x85).put(0x02, (byte) 0xff).put(0x03, (short) 0x8000).put(0x04, -1).put(0x05, true));
        info2C("2C info bool 2", new HuaweiTLV().put(0x01, (byte) 0x85).put(0x02, (byte) 0).put(0x03, (short) 1).put(0x04, 1).put(0x05, (byte) 2));
        info2C("2C info missing block size", new HuaweiTLV().put(0x01, (byte) 0x85).put(0x02, (byte) 10).put(0x03, (short) 1000).put(0x05, false));
        info2C("2C info burst 1 byte", new HuaweiTLV().put(0x01, (byte) 0x85).put(0x02, (byte) 10).put(0x03, (byte) 7).put(0x04, 1).put(0x05, false));
        info2C("2C info empty bool", new HuaweiTLV().put(0x01, (byte) 0x85).put(0x02, (byte) 10).put(0x03, (short) 1).put(0x04, 1).put(0x05));

        incoming2C("2C incoming ok", new HuaweiTLV().put(0x01, "x.bin").put(0x02, (byte) 0x10).put(0x03, (byte) 4).put(0x04, 777)
                .put(0x07, "desc").put(0x08, "src.pkg").put(0x09, "dst.pkg").put(0x0a, "sfp").put(0x0b, "dfp"));
        incoming2C("2C incoming no fingerprints", new HuaweiTLV().put(0x01, "x.bin").put(0x02, (byte) 0x10).put(0x03, (byte) 4).put(0x04, 777)
                .put(0x07, "d").put(0x08, "s").put(0x09, "t"));
        incoming2C("2C incoming one fingerprint", new HuaweiTLV().put(0x01, "x.bin").put(0x02, (byte) 0x10).put(0x03, (byte) 4).put(0x04, 777)
                .put(0x07, "d").put(0x08, "s").put(0x09, "t").put(0x0b, "dfp"));
        incoming2C("2C incoming size 1 byte", new HuaweiTLV().put(0x01, "x.bin").put(0x02, (byte) 0x10).put(0x03, (byte) 4).put(0x04, bytes(0xf0))
                .put(0x07, "d").put(0x08, "s").put(0x09, "t"));
        incoming2C("2C incoming size 2 bytes", new HuaweiTLV().put(0x01, "x.bin").put(0x02, (byte) 0x10).put(0x03, (byte) 4).put(0x04, bytes(0xf0, 0x01))
                .put(0x07, "d").put(0x08, "s").put(0x09, "t"));
        incoming2C("2C incoming size 3 bytes", new HuaweiTLV().put(0x01, "x.bin").put(0x02, (byte) 0x10).put(0x03, (byte) 4).put(0x04, bytes(0xf0, 0x01, 2))
                .put(0x07, "d").put(0x08, "s").put(0x09, "t"));
        incoming2C("2C incoming size 4 bytes negative", new HuaweiTLV().put(0x01, "x.bin").put(0x02, (byte) 0x10).put(0x03, (byte) 4).put(0x04, bytes(0xf0, 0x01, 2, 3))
                .put(0x07, "d").put(0x08, "s").put(0x09, "t"));
        incoming2C("2C incoming missing description", new HuaweiTLV().put(0x01, "x.bin").put(0x02, (byte) 0x10).put(0x03, (byte) 4).put(0x04, 777)
                .put(0x08, "s").put(0x09, "t"));
        incoming2C("2C incoming missing dst package", new HuaweiTLV().put(0x01, "x.bin").put(0x02, (byte) 0x10).put(0x03, (byte) 4).put(0x04, 777)
                .put(0x07, "d").put(0x08, "s"));

        init0A("0A init two names", new HuaweiTLV().put(0x01, "sleep_state.bin;sleep_data.bin"));
        init0A("0A init trailing separator", new HuaweiTLV().put(0x01, "a.bin;b.bin;"));
        init0A("0A init trailing separators", new HuaweiTLV().put(0x01, "a.bin;;;"));
        init0A("0A init leading separator", new HuaweiTLV().put(0x01, ";a.bin"));
        init0A("0A init empty", new HuaweiTLV().put(0x01, ""));
        init0A("0A init only separator", new HuaweiTLV().put(0x01, ";"));
        init0A("0A init only separators", new HuaweiTLV().put(0x01, ";;;"));
        init0A("0A init empty between", new HuaweiTLV().put(0x01, "a;;b"));
        init0A("0A init one name", new HuaweiTLV().put(0x01, "7_gps.bin"));
        init0A("0A init gps nested", new HuaweiTLV().put(0x09, (short) 7)
                .put(0x8b, new HuaweiTLV().put(0x8c, new HuaweiTLV().put(0x0d, "7_gps.bin;7_aux.bin")))
                .put(0x0e, (byte) 1));
        init0A("0A init gps nested missing", new HuaweiTLV().put(0x8b, new HuaweiTLV().put(0x8d, new HuaweiTLV().put(0x0d, "x"))));
        init0A("0A init nothing", new HuaweiTLV());
        init0A("0A init name wins over nested", new HuaweiTLV().put(0x01, "first").put(0x8b, new HuaweiTLV().put(0x8c, new HuaweiTLV().put(0x0d, "second"))));

        parameters0A("0A parameters ok", new HuaweiTLV().put(0x01, "1.0").put(0x02, true).put(0x03, (short) 244).put(0x04, (short) 4096).put(0x05, (short) 30));
        parameters0A("0A parameters negative", new HuaweiTLV().put(0x01, "v").put(0x02, false).put(0x03, (short) -1).put(0x04, (short) 0x8000).put(0x05, (short) -3));
        parameters0A("0A parameters missing timeout", new HuaweiTLV().put(0x01, "v").put(0x02, false).put(0x03, (short) 1).put(0x04, (short) 2));
        parameters0A("0A parameters byte block size", new HuaweiTLV().put(0x01, "v").put(0x02, false).put(0x03, (short) 1).put(0x04, (byte) 2).put(0x05, (short) 5));
        parameters0A("0A parameters empty version", new HuaweiTLV().put(0x01, "").put(0x02, true).put(0x03, (short) 1).put(0x04, (short) 2).put(0x05, (short) 5));

        info0A("0A info ok", new HuaweiTLV().put(0x02, 1500).put(0x04, (byte) 1).put(0x05, 1700000000).put(0x06, (byte) 3));
        info0A("0A info only length", new HuaweiTLV().put(0x02, 99));
        info0A("0A info none", new HuaweiTLV());
        info0A("0A info negative", new HuaweiTLV().put(0x02, -7).put(0x04, (byte) 0xfe).put(0x05, -9).put(0x06, (byte) 0x80));
        info0A("0A info short length", new HuaweiTLV().put(0x02, (short) 99));
        info0A("0A info empty type", new HuaweiTLV().put(0x02, 5).put(0x04, new byte[0]));
        info0A("0A info type and time only", new HuaweiTLV().put(0x04, (byte) 2).put(0x05, 42));

        block0A("0A block ok", new HuaweiTLV().put(0x7f, 0x000186A0).put(0x01, "sleep_data.bin").put(0x02, 4096));
        block0A("0A block ok no name", new HuaweiTLV().put(0x7f, 0x000186A0));
        block0A("0A block not ok", new HuaweiTLV().put(0x7f, 5).put(0x01, "x").put(0x02, 1));
        block0A("0A block missing 7f", new HuaweiTLV().put(0x01, "x"));
        block0A("0A block 7f short", new HuaweiTLV().put(0x7f, bytes(1, 0x86)));
    }

    // ---- data blocks (raw payloads)

    static final JSONArray blocks = GoldenSupport.arr();

    static void block(String name, int sid, int cid, byte[] body, PP pp) {
        JSONObject o = GoldenSupport.obj();
        o.put("name", name);
        o.put("service", sid);
        o.put("command", cid);
        o.put("key", pp.getSecretKey() == null ? JSONObject.NULL : GoldenSupport.hex(pp.getSecretKey()));
        o.put("encryptMethod", pp.getEncryptMethod() & 0xFF);
        o.put("deviceSupportType", pp.getDeviceSupportType() & 0xFF);
        byte[] frame = rawFrame(sid, cid, body);
        o.put("frame", GoldenSupport.hex(frame));
        o.put("result", resultOf(frame, pp, (p, out) -> {
            if (sid == 0x2c) {
                FileDownloadService2C.BlockResponse r = (FileDownloadService2C.BlockResponse) p;
                out.put("fileId", r.fileId & 0xFF).put("offset", r.offset).put("unknown", r.unknown & 0xFF).put("data", GoldenSupport.hex(r.data));
            } else {
                FileDownloadService0A.BlockResponse r = (FileDownloadService0A.BlockResponse) p;
                out.put("number", r.number & 0xFF).put("data", GoldenSupport.hex(r.data));
                // BlockResponse catches HuaweiCrypto.CryptoException (not HuaweiPacket.CryptoException, which the Kotlin FileDownloader tests for)
                out.put("decodeError", r.e == null ? JSONObject.NULL : (r.e instanceof nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiCrypto.CryptoException ? "crypto" : "notTLV"));
                out.put("decodeErrorIsPacketCryptoException", r.e instanceof HuaweiPacket.CryptoException);
            }
        }));
        blocks.put(o);
    }

    static byte[] plain2C(int fileId, int offset, int unknown, byte[] data) {
        return cat(new byte[] {(byte) fileId}, be32(offset), new byte[] {(byte) unknown}, data);
    }

    static void blocks() throws Exception {
        PP clear = params(0xf4, 0, 1, null, true);
        PP cbc = params(0xf4, 0, 1, KEY, true);
        PP gcm = params(0xf4, 1, 1, KEY, true);
        PP dst4 = params(0xf4, 0, 4, KEY, true);
        byte[] data = GoldenSupport.bytes(5300, 200);

        // 0x2c/0x05: plain body = fileId, offset (int), unknown, data
        block("2C plain", 0x2c, 0x05, plain2C(5, 0, 0, data), clear);
        block("2C plain, offset and unknown", 0x2c, 0x05, plain2C(0x85, 0x12345678, 0xfe, data), clear);
        block("2C plain, negative offset", 0x2c, 0x05, plain2C(1, -4096, 1, data), clear);
        block("2C plain, empty data", 0x2c, 0x05, plain2C(5, 100, 0, new byte[0]), clear);
        block("2C plain, six bytes only", 0x2c, 0x05, plain2C(5, 100, 0, new byte[0]), cbc);
        block("2C plain, five bytes (underflow)", 0x2c, 0x05, new byte[] {5, 0, 0, 0, 1}, clear);
        block("2C plain, three bytes", 0x2c, 0x05, new byte[] {5, 0, 0}, clear);
        block("2C plain, one byte", 0x2c, 0x05, new byte[] {5}, clear);
        block("2C plain, empty body", 0x2c, 0x05, new byte[0], clear);
        block("2C plain starting like a TLV marker but not one", 0x2c, 0x05, plain2C(0x7c, 0x01000000, 0, data), clear);
        block("2C plain 7c 01 00", 0x2c, 0x05, cat(new byte[] {0x7c, 0x01, 0x00, 0, 0, 0, 0, 0}, data), clear);
        for (Object[] c : new Object[][] {{"cbc", cbc}, {"gcm", gcm}, {"deviceSupportType 4", dst4}}) {
            PP pp = (PP) c[1];
            byte[] enc = HuaweiTLV.encryptRaw(pp, plain2C(0x16, 8192, 3, data)).serialize();
            block("2C encrypted " + c[0], 0x2c, 0x05, enc, pp);
            byte[] enc0 = HuaweiTLV.encryptRaw(pp, new byte[0]).serialize();
            block("2C encrypted empty plain " + c[0], 0x2c, 0x05, enc0, pp);
            byte[] encShort = HuaweiTLV.encryptRaw(pp, new byte[] {1, 2, 3}).serialize();
            block("2C encrypted too short " + c[0], 0x2c, 0x05, encShort, pp);
        }
        // encrypted but the receiver has no key / the wrong key / garbled cipher
        block("2C encrypted, no key", 0x2c, 0x05, HuaweiTLV.encryptRaw(cbc, plain2C(5, 0, 0, data)).serialize(), clear);
        block("2C encrypted, wrong key", 0x2c, 0x05, HuaweiTLV.encryptRaw(cbc, plain2C(5, 0, 0, data)).serialize(), params(0xf4, 0, 1, GoldenSupport.bytes(5301, 16), true));
        {
            byte[] enc = HuaweiTLV.encryptRaw(cbc, plain2C(5, 0, 0, data)).serialize();
            byte[] garbled = enc.clone();
            garbled[garbled.length - 3] ^= 0x55;
            block("2C encrypted, garbled cipher", 0x2c, 0x05, garbled, cbc);
            block("2C encrypted, truncated", 0x2c, 0x05, java.util.Arrays.copyOf(enc, enc.length - 7), cbc);
            block("2C marker with no cipher", 0x2c, 0x05, new HuaweiTLV().put(0x7c, (byte) 1).serialize(), cbc);
            block("2C marker with iv only", 0x2c, 0x05, new HuaweiTLV().put(0x7c, (byte) 1).put(0x7d, GoldenSupport.bytes(5302, 16)).serialize(), cbc);
        }

        // 0x0a/0x05: first byte is the packet number; the rest data, either as is or inside an encrypted TLV
        block("0A plain data (not TLV)", 0x0a, 0x05, cat(new byte[] {0}, data), clear);
        block("0A plain data, number 200", 0x0a, 0x05, cat(new byte[] {(byte) 200}, GoldenSupport.bytes(5303, 50)), cbc);
        block("0A number only", 0x0a, 0x05, new byte[] {7}, clear);
        block("0A empty body", 0x0a, 0x05, new byte[0], clear);
        block("0A plain data that parses as TLV without cipher", 0x0a, 0x05, new byte[] {3, 0x41, 0x01, 0x42, 0x42, 0x00}, cbc);
        block("0A plain data, single zero", 0x0a, 0x05, new byte[] {0, 0}, cbc);
        block("0A plain data, two bytes tag 0 len 0", 0x0a, 0x05, new byte[] {1, 0, 0, 0}, clear);
        block("0A data that is a valid TLV without the cipher elements", 0x0a, 0x05, new byte[] {0x41, 0x01, 0x42}, cbc);
        block("0A data that is a valid TLV with only a cipher element", 0x0a, 0x05, new byte[] {0x7e, 0x01, 0x42}, cbc);
        block("0A data that is a valid TLV with iv and an unaligned cipher", 0x0a, 0x05, cat(new byte[] {0x7d, 0x10}, GoldenSupport.bytes(5306, 16), new byte[] {0x7e, 0x03, 1, 2, 3}), cbc);
        block("0A data that is a valid TLV with iv and a block of zeros", 0x0a, 0x05, cat(new byte[] {0x7d, 0x10}, GoldenSupport.bytes(5307, 16), new byte[] {0x7e, 0x10}, new byte[16]), cbc);
        for (Object[] c : new Object[][] {{"cbc", cbc}, {"gcm", gcm}, {"deviceSupportType 4", dst4}}) {
            PP pp = (PP) c[1];
            byte[] enc = HuaweiTLV.encryptRaw(pp, cat(new byte[] {9}, data)).serialize();
            block("0A encrypted " + c[0], 0x0a, 0x05, enc, pp);
            block("0A encrypted number only " + c[0], 0x0a, 0x05, HuaweiTLV.encryptRaw(pp, new byte[] {(byte) 0x80}).serialize(), pp);
            block("0A encrypted empty plain " + c[0], 0x0a, 0x05, HuaweiTLV.encryptRaw(pp, new byte[0]).serialize(), pp);
        }
        block("0A encrypted, no key", 0x0a, 0x05, HuaweiTLV.encryptRaw(cbc, cat(new byte[] {9}, data)).serialize(), clear);
        block("0A encrypted, wrong key", 0x0a, 0x05, HuaweiTLV.encryptRaw(cbc, cat(new byte[] {9}, data)).serialize(), params(0xf4, 0, 1, GoldenSupport.bytes(5304, 16), true));
        {
            byte[] enc = HuaweiTLV.encryptRaw(cbc, cat(new byte[] {9}, data)).serialize();
            byte[] garbled = enc.clone();
            garbled[garbled.length - 3] ^= 0x55;
            block("0A encrypted, garbled cipher", 0x0a, 0x05, garbled, cbc);
            block("0A encrypted, truncated", 0x0a, 0x05, java.util.Arrays.copyOf(enc, enc.length - 7), cbc);
            block("0A marker with iv only", 0x0a, 0x05, new HuaweiTLV().put(0x7c, (byte) 1).put(0x7d, GoldenSupport.bytes(5305, 16)).serialize(), cbc);
        }
    }

    public static void main(String[] args) throws Exception {
        requests();
        responses();
        blocks();
        JSONObject root = GoldenSupport.obj();
        root.put("key", GoldenSupport.hex(KEY));
        root.put("requests", requests);
        root.put("responses", responses);
        root.put("blocks", blocks);
        GoldenSupport.write(args[0], "sleep_packets.json", root);
    }
}

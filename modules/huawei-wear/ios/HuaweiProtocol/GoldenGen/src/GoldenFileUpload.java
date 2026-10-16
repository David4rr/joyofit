import java.util.List;

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.FileUpload;

import org.json.JSONArray;
import org.json.JSONObject;

/** FileUpload (service 0x28): every request the phone sends, the chunk framing (serializeFileChunk) and the watch's answers, from the real Java. */
public class GoldenFileUpload {
    static byte[] b(int... v) {
        byte[] out = new byte[v.length];
        for (int i = 0; i < v.length; i++) out[i] = (byte) v[i];
        return out;
    }

    /** A request that may fail to construct (GB splits the file name on '_' and indexes the parts). */
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

    static JSONObject info(String name, int size, String file, int type, String src, String dst, String srcFp, String dstFp) {
        JSONObject o = request(name, () -> new FileUpload.FileInfoSend.Request(PacketsGoldenKit.params(), size, file, (byte) type, src, dst, srcFp, dstFp));
        o.put("fileSize", size).put("fileName", file).put("fileType", type);
        o.put("src", src == null ? JSONObject.NULL : src).put("dst", dst == null ? JSONObject.NULL : dst);
        o.put("srcFingerprint", srcFp == null ? JSONObject.NULL : srcFp).put("dstFingerprint", dstFp == null ? JSONObject.NULL : dstFp);
        return o;
    }

    static final PacketsGoldenKit.Dumper CONSULT = (parsed, fields) -> {
        FileUpload.FileUploadParams p = ((FileUpload.FileUploadConsultAck.Response) parsed).fileUploadParams;
        fields.put("fileId", (int) p.file_id);
        fields.put("protocolVersion", p.protocolVersion);
        fields.put("appWaitTime", p.app_wait_time);
        fields.put("bitmapEnable", p.bitmap_enable);
        fields.put("unitSize", p.unit_size);
        fields.put("maxApplyDataSize", p.max_apply_data_size);
        fields.put("interval", p.interval);
        fields.put("receivedFileSize", p.received_file_size);
        fields.put("noEncrypt", (int) p.no_encrypt);
    };

    static final PacketsGoldenKit.Dumper NEXT_CHUNK = (parsed, fields) -> {
        FileUpload.FileNextChunkParams p = (FileUpload.FileNextChunkParams) parsed;
        fields.put("bytesUploaded", p.bytesUploaded);
        fields.put("nextchunkSize", p.nextchunkSize);
    };

    static JSONObject chunk(String name, byte[] data, int position, int unit, int fileId, int sliceSize) throws Exception {
        HuaweiPacket.ParamsProvider pp = PacketsGoldenKit.params();
        pp.setSliceSize(sliceSize);
        List<byte[]> frames = new FileUpload.FileNextChunkSend(pp).serializeFileChunk(data, position, unit, (byte) fileId, false);
        JSONObject o = GoldenSupport.obj();
        o.put("name", name);
        o.put("data", GoldenSupport.hex(data));
        o.put("position", position).put("unit", unit).put("fileId", fileId).put("sliceSize", sliceSize);
        JSONArray fa = GoldenSupport.arr();
        for (byte[] f : frames) fa.put(GoldenSupport.hex(f));
        o.put("frames", fa);
        return o;
    }

    public static void main(String[] args) throws Exception {
        JSONObject root = GoldenSupport.obj();
        final HuaweiPacket.ParamsProvider pp = PacketsGoldenKit.params();

        JSONArray requests = GoldenSupport.arr();
        requests.put(info("watchface", 1000, "123456789_2.8.2", 1, null, null, null, null));
        requests.put(info("music", 77, "song.mp3", 2, null, null, null, null));
        requests.put(info("p2p route", 5, "a_b", 6, "com.src", "com.dst", "AA:BB", "CC:DD"));
        requests.put(info("p2p route without fingerprints", 5, "x_y", 6, "com.src", "com.dst", null, null));
        requests.put(info("src without dst", 5, "x_y", 6, "com.src", null, "AA", "BB"));
        requests.put(info("watchface name with extra underscore", 9, "12_1.0_beta", 1, null, null, null, null));
        requests.put(info("watchface leading underscore", 9, "_1.0.0", 1, null, null, null, null));
        requests.put(info("watchface without version", 9, "123456789", 1, null, null, null, null));
        requests.put(info("watchface trailing underscore", 9, "123_", 1, null, null, null, null));
        requests.put(info("watchface only underscore", 9, "_", 1, null, null, null, null));
        requests.put(info("background image no underscore", 9, "bg", 3, null, null, null, null));
        requests.put(info("negative size", -1, "n_1", 1, null, null, null, null));
        for (int[] c : new int[][] {{0, 7}, {1, 7}, {0, 0}, {1, 255}}) {
            final int fileId = c[1];
            final int noEnc = c[0];
            JSONObject o = request("ack noEncryption=" + noEnc + " id=" + fileId, () -> new FileUpload.FileUploadConsultAck.Request(pp, (byte) noEnc, (byte) fileId));
            o.put("noEncryption", noEnc).put("fileId", fileId);
            requests.put(o);
        }
        for (int id : new int[] {0, 7, 200}) {
            JSONObject o = request("result ack id=" + id, () -> new FileUpload.FileUploadResult.Request(pp, (byte) id));
            o.put("fileId", id);
            requests.put(o);
        }
        for (byte[] hash : new byte[][] {GoldenSupport.bytes(1, 32), new byte[0], b(1, 2, 3)}) {
            JSONObject o = request("hash len=" + hash.length, () -> new FileUpload.FileHashSend.Request(pp, hash, (byte) 9));
            o.put("hash", GoldenSupport.hex(hash)).put("fileId", 9);
            requests.put(o);
        }
        root.put("requests", requests);

        JSONArray chunks = GoldenSupport.arr();
        chunks.put(chunk("two units and a rest", b(1, 2, 3, 4, 5), 100, 2, 9, 0xf4));
        chunks.put(chunk("exact multiple", b(1, 2, 3, 4), 0, 2, 3, 0xf4));
        chunks.put(chunk("one unit", GoldenSupport.bytes(2, 40), 4096, 64, 1, 0xf4));
        chunks.put(chunk("empty chunk", new byte[0], 0, 8, 1, 0xf4));
        chunks.put(chunk("units that need slicing", GoldenSupport.bytes(3, 2000), 70000, 700, 7, 0xf4));
        chunks.put(chunk("unit that just fits one frame", GoldenSupport.bytes(4, 480), 0, 233, 7, 0xf4));
        chunks.put(chunk("small slice size", GoldenSupport.bytes(5, 300), 12, 120, 255, 64));
        chunks.put(chunk("big position", GoldenSupport.bytes(6, 10), 0x7FFFFFF0, 4, 2, 0xf4));
        chunks.put(chunk("more than 256 units", GoldenSupport.bytes(7, 600), 0, 2, 2, 0xf4));
        root.put("chunks", chunks);

        JSONArray responses = GoldenSupport.arr();
        responses.put(PacketsGoldenKit.response("info ok", 0x28, 0x02, new HuaweiTLV().put(0x7f, 100000)));
        responses.put(PacketsGoldenKit.response("info too many faces", 0x28, 0x02, new HuaweiTLV().put(0x7f, 140004)));
        responses.put(PacketsGoldenKit.response("info no status", 0x28, 0x02, new HuaweiTLV().put(0x01, "x")));
        responses.put(PacketsGoldenKit.response("info short status", 0x28, 0x02, new HuaweiTLV().put(0x7f, b(1, 2))));
        responses.put(PacketsGoldenKit.response("hash file id", 0x28, 0x03, new HuaweiTLV().put(0x01, (byte) 4)));
        responses.put(PacketsGoldenKit.response("hash file id high", 0x28, 0x03, new HuaweiTLV().put(0x01, (byte) 0xF0)));
        responses.put(PacketsGoldenKit.response("hash no id", 0x28, 0x03, new HuaweiTLV().put(0x02, (byte) 4)));
        responses.put(PacketsGoldenKit.response("hash empty id", 0x28, 0x03, new HuaweiTLV().put(0x01, new byte[0])));

        responses.put(PacketsGoldenKit.response("consult full", 0x28, 0x04, new HuaweiTLV().put(0x01, (byte) 3).put(0x02, "1.0").put(0x03, 5000)
            .put(0x04, 1).put(0x05, 1000).put(0x06, 60000).put(0x07, 10).put(0x08, 0).serialize(), pp, CONSULT));
        responses.put(PacketsGoldenKit.response("consult no encrypt", 0x28, 0x04, new HuaweiTLV().put(0x01, (byte) 3).put(0x02, "1.0").put(0x03, 5000)
            .put(0x04, 1).put(0x05, 1000).put(0x06, 60000).put(0x07, 10).put(0x08, 123).put(0x09, (byte) 1).serialize(), pp, CONSULT));
        responses.put(PacketsGoldenKit.response("consult short ints", 0x28, 0x04, new HuaweiTLV().put(0x01, (byte) 9).put(0x02, "").put(0x03, (short) 500)
            .put(0x04, (byte) 1).put(0x05, (short) 244).put(0x06, (short) 4096).put(0x07, (byte) 5).put(0x08, 0).serialize(), pp, CONSULT));
        responses.put(PacketsGoldenKit.response("consult without unit", 0x28, 0x04, new HuaweiTLV().put(0x01, (byte) 3).put(0x02, "1.0").put(0x03, 5000)
            .put(0x04, 1).serialize(), pp, CONSULT));
        responses.put(PacketsGoldenKit.response("consult short received size", 0x28, 0x04, new HuaweiTLV().put(0x01, (byte) 3).put(0x02, "1.0").put(0x03, 5000)
            .put(0x04, 1).put(0x05, 1000).put(0x06, 60000).put(0x07, 10).put(0x08, b(0, 1)).serialize(), pp, CONSULT));
        responses.put(PacketsGoldenKit.response("consult zero unit", 0x28, 0x04, new HuaweiTLV().put(0x01, (byte) 3).put(0x02, "1.0").put(0x03, 5000)
            .put(0x04, 1).put(0x05, 0).put(0x06, 100).put(0x07, 10).put(0x08, 0).serialize(), pp, CONSULT));

        responses.put(PacketsGoldenKit.response("next chunk", 0x28, 0x05, new HuaweiTLV().put(0x02, 4096).put(0x03, 8192).serialize(), pp, NEXT_CHUNK));
        responses.put(PacketsGoldenKit.response("next chunk first", 0x28, 0x05, new HuaweiTLV().put(0x02, 0).put(0x03, 300).serialize(), pp, NEXT_CHUNK));
        responses.put(PacketsGoldenKit.response("next chunk negative", 0x28, 0x05, new HuaweiTLV().put(0x02, -5).put(0x03, -1).serialize(), pp, NEXT_CHUNK));
        responses.put(PacketsGoldenKit.response("next chunk without size", 0x28, 0x05, new HuaweiTLV().put(0x02, 5).serialize(), pp, NEXT_CHUNK));
        responses.put(PacketsGoldenKit.response("next chunk short position", 0x28, 0x05, new HuaweiTLV().put(0x02, b(1)).put(0x03, 5).serialize(), pp, NEXT_CHUNK));

        responses.put(PacketsGoldenKit.response("result status 0 (byte)", 0x28, 0x07, new HuaweiTLV().put(0x02, (byte) 0)));
        responses.put(PacketsGoldenKit.response("result status 1 (byte)", 0x28, 0x07, new HuaweiTLV().put(0x02, (byte) 1)));
        responses.put(PacketsGoldenKit.response("result status int", 0x28, 0x07, new HuaweiTLV().put(0x02, 100000)));
        responses.put(PacketsGoldenKit.response("result status short", 0x28, 0x07, new HuaweiTLV().put(0x02, (short) 300)));
        responses.put(PacketsGoldenKit.response("result without status", 0x28, 0x07, new HuaweiTLV().put(0x01, (byte) 7)));
        responses.put(PacketsGoldenKit.response("result five byte status", 0x28, 0x07, new HuaweiTLV().put(0x02, b(1, 2, 3, 4, 5))));
        responses.put(PacketsGoldenKit.response("result empty status", 0x28, 0x07, new HuaweiTLV().put(0x02, new byte[0])));

        responses.put(PacketsGoldenKit.response("device error", 0x28, 0x08, new HuaweiTLV().put(0x01, (byte) 7).put(0x7f, 140009)));
        responses.put(PacketsGoldenKit.response("device error without id", 0x28, 0x08, new HuaweiTLV().put(0x7f, 140009)));
        responses.put(PacketsGoldenKit.response("device error without code", 0x28, 0x08, new HuaweiTLV().put(0x01, (byte) 7)));
        responses.put(PacketsGoldenKit.response("device error byte code", 0x28, 0x08, new HuaweiTLV().put(0x01, (byte) 7).put(0x7f, (byte) 3)));
        responses.put(PacketsGoldenKit.response("device error empty", 0x28, 0x08, new HuaweiTLV()));
        root.put("responses", responses);

        GoldenSupport.write(args[0], "packetsFileUpload.json", root);
    }
}

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.P2P;
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.HuaweiP2PManager;
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.HuaweiBaseP2PService;
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.HuaweiP2PDataDictionarySyncService;
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.dictionarysync.HuaweiDictionarySyncInterface;
import nodomain.freeyourgadget.gadgetbridge.service.devices.huawei.p2p.utils.HuaweiP2PSubMsg;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The P2P service (0x34/0x01) built by the real Java: the request packets, the manager (sequence, wake-app answers, routing), the base service
 * (ping, data, acknowledgements, waiting callbacks), the sub-message header and the data dictionary sync (request payloads, paging, every
 * dictionary handler's rows).
 */
public class GoldenP2p {
    /** Records what the manager sends; the log lines are not part of the fixture. */
    static class Capture implements HuaweiP2PManager.Transport {
        final JSONArray sent = GoldenSupport.arr();
        boolean expand14 = true;

        @Override
        public void sendP2P(byte cmdId, short sequence, String srcPackage, String dstPackage, String srcFingerprint, String dstFingerprint, byte[] sendData, int sendCode) throws IOException {
            JSONObject o = GoldenSupport.obj();
            o.put("cmd", cmdId & 0xFF);
            o.put("seq", (int) sequence);
            o.put("src", srcPackage == null ? JSONObject.NULL : srcPackage);
            o.put("dst", dstPackage == null ? JSONObject.NULL : dstPackage);
            o.put("srcFp", srcFingerprint == null ? JSONObject.NULL : srcFingerprint);
            o.put("dstFp", dstFingerprint == null ? JSONObject.NULL : dstFingerprint);
            o.put("data", sendData == null ? JSONObject.NULL : GoldenSupport.hex(sendData));
            o.put("code", sendCode);
            // the wire form of the same call
            HuaweiPacket p = new P2P.P2PCommand.Request(PacketsGoldenKit.params(), cmdId, sequence, srcPackage, dstPackage, srcFingerprint, dstFingerprint, sendData, sendCode);
            try {
                o.put("tlv", GoldenSupport.hex(p.getTlv().serialize()));
            } catch (Exception e) {
                throw new IOException(e);
            }
            sent.put(o);
        }

        @Override
        public boolean supportsExpandCapability(int which) {
            return which == 14 ? expand14 : false;
        }

        @Override
        public void log(String message) {}

        JSONArray take() {
            JSONArray copy = new JSONArray();
            for (int i = 0; i < sent.length(); i++) copy.put(sent.get(i));
            while (sent.length() > 0) sent.remove(0);
            return copy;
        }
    }

    /** A module that records what reaches it. */
    static class Probe extends HuaweiBaseP2PService {
        final JSONArray events = GoldenSupport.arr();
        int pingAnswer = 0xcf;
        int dataAnswer = 0xcf;

        Probe(HuaweiP2PManager m) { super(m); }
        @Override public String getModule() { return "probe.module"; }
        @Override public String getPackage() { return "probe.package"; }
        @Override public String getFingerprint() { return "ProbeFp"; }
        @Override public void registered() { events.put("registered"); }
        @Override public void unregister() { events.put("unregister"); }
        @Override public void handleData(byte[] data) { events.put("data:" + GoldenSupport.hex(data)); }
        @Override protected int onPingPacket(P2P.P2PCommand.Response packet) { return pingAnswer; }
        @Override protected int onDataPacket(P2P.P2PCommand.Response packet) { return dataAnswer; }
        @Override public void handleFile(String filename, byte[] data) { events.put("file:" + filename + ":" + GoldenSupport.hex(data)); }
    }

    static P2P.P2PCommand.Response response(int cmd, int seq, String src, String dst, byte[] data, Integer code, boolean codeAsByte) throws Exception {
        HuaweiTLV tlv = new HuaweiTLV().put(0x01, (byte) cmd).put(0x02, (short) seq).put(0x03, src).put(0x04, dst);
        if (data != null) tlv.put(0x07, data);
        if (code != null) {
            if (codeAsByte) tlv.put(0x08, (byte) (int) code); else tlv.put(0x08, (int) code);
        }
        HuaweiPacket.ParamsProvider pp = PacketsGoldenKit.params();
        byte[] frame = new PacketsGoldenKit.Raw(pp, 0x34, 0x01, tlv.serialize()).serialize().get(0);
        HuaweiPacket parsed = new HuaweiPacket(pp).parse(frame);
        parsed.parseTlv();
        return (P2P.P2PCommand.Response) parsed;
    }

    static JSONObject req(String name, int cmd, int seq, String src, String dst, String srcFp, String dstFp, byte[] data, int code) throws Exception {
        JSONObject o = PacketsGoldenKit.request(name, new P2P.P2PCommand.Request(PacketsGoldenKit.params(), (byte) cmd, (short) seq, src, dst, srcFp, dstFp, data, code));
        o.put("cmd", cmd);
        o.put("seq", seq);
        o.put("src", src);
        o.put("dst", dst);
        o.put("srcFp", srcFp == null ? JSONObject.NULL : srcFp);
        o.put("dstFp", dstFp == null ? JSONObject.NULL : dstFp);
        o.put("data", data == null ? JSONObject.NULL : GoldenSupport.hex(data));
        o.put("code", code);
        return o;
    }

    static JSONObject resp(String name, int cmd, int seq, String src, String dst, byte[] data, Integer code, boolean codeAsByte, boolean fingerprints) throws Exception {
        HuaweiTLV tlv = new HuaweiTLV().put(0x01, (byte) cmd).put(0x02, (short) seq).put(0x03, src).put(0x04, dst);
        if (fingerprints) tlv.put(0x05, "srcFp").put(0x06, "dstFp");
        if (data != null) tlv.put(0x07, data);
        if (code != null) {
            if (codeAsByte) tlv.put(0x08, (byte) (int) code); else tlv.put(0x08, (int) code);
        }
        JSONObject o = PacketsGoldenKit.response(name, 0x34, 0x01, tlv.serialize());
        return o;
    }

    static JSONObject ack(String key, JSONObject v) { return v; }

    public static void main(String[] args) throws Exception {
        JSONObject root = GoldenSupport.obj();

        // requests
        JSONArray requests = GoldenSupport.arr();
        requests.put(req("ping", 1, 2, "com.huawei.health", "hw.watch.health.filesync", null, null, null, 0));
        requests.put(req("data", 2, 3, "hw.unitedevice.healthmodel", "com.huawei.health.healthyliving", "UniteDeviceManagement", "SystemApp", new byte[] {1, 2, 3}, 0));
        requests.put(req("data empty payload", 2, 4, "m", "p", "a", "b", new byte[0], 0));
        requests.put(req("data no payload", 2, 5, "m", "p", "a", "b", null, 0));
        requests.put(req("ack", 3, 300, "p", "m", null, null, null, 0xcf));
        requests.put(req("ack d2", 3, 32765, "p", "m", null, null, null, 0xd2));
        requests.put(req("ack ignores payload on ping", 1, 7, "m", "p", "ignored", "ignored", new byte[] {9}, 5));
        requests.put(req("get version", 4, 8, "hw.unitedevice.fitness", "in.huawei.fitness", null, null, null, 0));
        root.put("requests", requests);

        // responses
        JSONArray responses = GoldenSupport.arr();
        responses.put(resp("ack with byte code", 3, 5, "a", "b", null, 0xca, true, false));
        responses.put(resp("ack with int code", 3, 5, "a", "b", null, 0xcf, false, false));
        responses.put(resp("data with fingerprints", 2, 6, "hw.watch.health.filesync", "hw.unitedevice.datadictionarysync", new byte[] {1, 0x22, 0x33}, null, false, true));
        responses.put(resp("ping", 1, 7, "a", "b", null, null, false, false));
        root.put("responses", responses);
        JSONObject missing = PacketsGoldenKit.response("missing cmd", 0x34, 0x01, new HuaweiTLV().put(0x02, (short) 1).put(0x03, "a").put(0x04, "b").serialize());
        responses.put(missing);

        // sub messages
        JSONArray subs = GoldenSupport.arr();
        for (Object[] c : new Object[][] {{3, 12345, new byte[] {1, 2, 3, 4}}, {2, 1, new byte[] {(byte) 0x82, 0x01, 0x05}}, {3, 999999, new byte[0]}}) {
            HuaweiP2PSubMsg m = new HuaweiP2PSubMsg((Integer) c[0], (Integer) c[1], (byte[]) c[2]);
            JSONObject o = GoldenSupport.obj();
            o.put("type", c[0]).put("messageId", c[1]).put("data", GoldenSupport.hex((byte[]) c[2]));
            o.put("bytes", GoldenSupport.hex(m.getBytes()));
            HuaweiP2PSubMsg back = new HuaweiP2PSubMsg(m.getBytes());
            o.put("parsedType", back.getType()).put("parsedVersion", back.getVersion()).put("parsedLength", back.getTotalLength())
                .put("parsedMessageId", back.getMessageId()).put("parsedData", back.getData() == null ? JSONObject.NULL : GoldenSupport.hex(back.getData()));
            subs.put(o);
        }
        // a header-only and a short buffer
        for (byte[] raw : new byte[][] {new byte[10], null, new HuaweiP2PSubMsg(3, 5, new byte[0]).getBytes(), GoldenSupport.bytes(5, 36)}) {
            JSONObject o = GoldenSupport.obj();
            o.put("raw", raw == null ? JSONObject.NULL : GoldenSupport.hex(raw));
            HuaweiP2PSubMsg m;
            try {
                m = new HuaweiP2PSubMsg(raw);
            } catch (java.nio.BufferUnderflowException e) {
                o.put("throws", true);
                subs.put(o);
                continue;
            }
            o.put("parsedType", m.getType()).put("parsedVersion", m.getVersion()).put("parsedLength", m.getTotalLength())
                .put("parsedMessageId", m.getMessageId()).put("parsedData", m.getData() == null ? JSONObject.NULL : GoldenSupport.hex(m.getData()));
            subs.put(o);
        }
        root.put("subMessages", subs);

        // sequence numbers
        {
            Capture cap = new Capture();
            HuaweiP2PManager manager = new HuaweiP2PManager(cap);
            JSONArray seq = GoldenSupport.arr();
            for (int i = 1; i <= 33000; i++) {
                short s = manager.getNextSequence();
                if (i <= 3 || (i >= 32763 && i <= 32770)) seq.put(new JSONArray().put(i).put((int) s));
            }
            root.put("sequence", seq);
        }

        // manager + base service
        {
            Capture cap = new Capture();
            HuaweiP2PManager manager = new HuaweiP2PManager(cap);
            Probe probe = new Probe(manager);
            probe.register();
            JSONArray steps = GoldenSupport.arr();
            // ping out, answered
            final int[] answered = {-1};
            probe.sendPing((code, data) -> answered[0] = code);
            steps.put(GoldenSupport.obj().put("do", "sendPing").put("sent", cap.take()));
            manager.handlePacket(response(2, 2, "probe.package", "com.huawei.health", null, 0xca, true));
            steps.put(GoldenSupport.obj().put("do", "answer ping 0xca").put("sent", cap.take()).put("callback", answered[0]));
            // command out, answered with the data
            final byte[][] got = {null};
            probe.sendCommand(new byte[] {7, 8, 9}, (code, data) -> { answered[0] = code; got[0] = data; });
            steps.put(GoldenSupport.obj().put("do", "sendCommand").put("sent", cap.take()));
            manager.handlePacket(response(2, 3, "probe.package", "probe.module", new byte[] {0x55}, 0xcf, true));
            steps.put(GoldenSupport.obj().put("do", "answer command").put("sent", cap.take()).put("callback", answered[0]).put("data", GoldenSupport.hex(got[0])));
            // version
            probe.sendGetVersion(null);
            steps.put(GoldenSupport.obj().put("do", "sendGetVersion").put("sent", cap.take()));
            cap.expand14 = false;
            probe.sendGetVersion(null);
            steps.put(GoldenSupport.obj().put("do", "sendGetVersion without bit 14").put("sent", cap.take()));
            // watch initiated
            manager.handlePacket(response(1, 40, "probe.package", "probe.module", null, null, false));
            steps.put(GoldenSupport.obj().put("do", "watch ping").put("sent", cap.take()));
            probe.pingAnswer = 0xca;
            manager.handlePacket(response(1, 41, "probe.package", "probe.module", null, null, false));
            steps.put(GoldenSupport.obj().put("do", "watch ping, answer 0xca").put("sent", cap.take()));
            manager.handlePacket(response(2, 42, "probe.package", "probe.module", new byte[] {1, 2}, null, false));
            steps.put(GoldenSupport.obj().put("do", "watch data").put("sent", cap.take()));
            manager.handlePacket(response(2, 43, "probe.package", "probe.module", null, null, false));
            steps.put(GoldenSupport.obj().put("do", "watch data without payload").put("sent", cap.take()));
            manager.handlePacket(response(2, 44, "other.package", "probe.module", new byte[] {3}, null, false));
            steps.put(GoldenSupport.obj().put("do", "watch data of another package").put("sent", cap.take()));
            manager.handlePacket(response(3, 45, "probe.package", "probe.module", null, 0xcf, true));
            steps.put(GoldenSupport.obj().put("do", "watch ack nobody waits for").put("sent", cap.take()));
            manager.handleFile("probe.package", "x", "y", "z", "f.bin", new byte[] {1});
            manager.handleFile("other", "x", "y", "z", "g.bin", new byte[] {2});
            // wake app
            manager.handlePacket(response(1, 50, "w.watch", "a.b.wakeapp", null, null, false));
            steps.put(GoldenSupport.obj().put("do", "wakeapp without data").put("sent", cap.take()));
            manager.handlePacket(response(1, 51, "w.watch", "a.b.wakeapp", new HuaweiTLV().put(0x04, "some://link").serialize(), null, false));
            steps.put(GoldenSupport.obj().put("do", "wakeapp with link").put("sent", cap.take()));
            manager.handlePacket(response(1, 52, "w.watch", "a.b.wakeapp", new HuaweiTLV().put(0x05, "x").serialize(), null, false));
            steps.put(GoldenSupport.obj().put("do", "wakeapp without link").put("sent", cap.take()));
            manager.handlePacket(response(1, 53, "w.watch", "a.b", null, null, false));
            steps.put(GoldenSupport.obj().put("do", "short destination").put("sent", cap.take()));
            // register twice, unregister all
            Probe second = new Probe(manager);
            second.register();
            manager.unregisterAllService();
            JSONObject o = GoldenSupport.obj();
            o.put("steps", steps);
            o.put("probeEvents", probe.events);
            o.put("secondEvents", second.events);
            root.put("manager", o);
        }

        // data dictionary sync
        {
            Capture cap = new Capture();
            HuaweiP2PManager manager = new HuaweiP2PManager(cap);
            HuaweiP2PDataDictionarySyncService svc = new HuaweiP2PDataDictionarySyncService(manager);
            JSONArray steps = GoldenSupport.arr();
            List<Integer> pings = new ArrayList<>();
            svc.setAvailabilityListener(pings::add);
            svc.register();
            steps.put(step("register", cap.take()));
            JSONArray events = GoldenSupport.arr();
            HuaweiP2PDataDictionarySyncService.DictionarySyncCallback cb = new HuaweiP2PDataDictionarySyncService.DictionarySyncCallback() {
                @Override public long onGetLastDataSyncTimestamp(int dictClass) { events.put("last:" + dictClass); return lastTs; }
                @Override public void onData(int dictClass, List<HuaweiP2PDataDictionarySyncService.DictData> dictData) { events.put(dumpData(dictClass, dictData)); }
                @Override public void onComplete(boolean complete) { events.put("complete:" + complete); }
            };
            // not available yet
            lastTs = 0;
            svc.startSync(List.of(500044), cb);
            steps.put(step("start while unavailable", cap.take()).put("events", take(events)));
            manager.handlePacket(response(2, 2, "hw.watch.health.filesync", "com.huawei.health", null, 0xca, true));
            steps.put(step("ping answered 0xca", cap.take()).put("pings", new JSONArray(pings)));
            lastTs = 1700000000000L;
            svc.startSync(List.of(500044, 400012, 500031), cb);
            steps.put(step("start three classes", cap.take()).put("events", take(events)));
            // page 1 of class 500044: two entries
            byte[] page1 = answer(1, 500044, new long[][] {{1700000100000L, 1700000160000L, 0}, {1700000200000L, 0, 1700000260000L}}, 500044831, 45.9);
            manager.handlePacket(response(2, 60, "hw.watch.health.filesync", "hw.unitedevice.datadictionarysync", page1, null, false));
            steps.put(step("page 1", cap.take()).put("events", take(events)));
            // an empty page ends the class: next class starts
            byte[] empty = answer(1, 500044, new long[0][], 0, 0);
            manager.handlePacket(response(2, 61, "hw.watch.health.filesync", "hw.unitedevice.datadictionarysync", empty, null, false));
            steps.put(step("empty page", cap.take()).put("events", take(events)));
            // the next class' answer, with a 3-byte class tag
            byte[] other = answer(1, 400012, new long[][] {{1700000300000L, 1700000300000L, 0}}, 400012430, 36.6);
            manager.handlePacket(response(2, 62, "hw.watch.health.filesync", "hw.unitedevice.datadictionarysync", other, null, false));
            steps.put(step("temperature page", cap.take()).put("events", take(events)));
            // the same page again does not advance the start time: the class ends, the next one starts
            manager.handlePacket(response(2, 63, "hw.watch.health.filesync", "hw.unitedevice.datadictionarysync", answer(1, 400012, new long[0][], 0, 0), null, false));
            steps.put(step("empty temperature page", cap.take()).put("events", take(events)));
            // unknown operation
            manager.handlePacket(response(2, 64, "hw.watch.health.filesync", "hw.unitedevice.datadictionarysync", answer(2, 500031, new long[0][], 0, 0), null, false));
            steps.put(step("unknown operation", cap.take()).put("events", take(events)));
            // an answer for a class nobody asked
            manager.handlePacket(response(2, 65, "hw.watch.health.filesync", "hw.unitedevice.datadictionarysync", answer(1, 700004, new long[0][], 0, 0), null, false));
            steps.put(step("unrequested class", cap.take()).put("events", take(events)));
            // a class that is already running
            svc.startSync(List.of(500002), cb);
            svc.startSync(List.of(500002), cb);
            steps.put(step("class in progress", cap.take()).put("events", take(events)));
            svc.cancelSync();
            svc.startSync(List.of(), cb);
            steps.put(step("empty list", cap.take()).put("events", take(events)));
            // a negative start time
            lastTs = -5;
            svc.startSync(List.of(500002), cb);
            steps.put(step("negative start", cap.take()).put("events", take(events)));
            svc.cancelSync();
            // other first byte, empty data
            manager.handlePacket(response(2, 66, "hw.watch.health.filesync", "hw.unitedevice.datadictionarysync", new byte[] {7, 1, 2}, null, false));
            manager.handlePacket(response(2, 67, "hw.watch.health.filesync", "hw.unitedevice.datadictionarysync", new byte[0], null, false));
            steps.put(step("ignored data", cap.take()).put("events", take(events)));
            // a block without a start time is a parse error: the class completes with false
            lastTs = 0;
            svc.startSync(List.of(500044), cb);
            cap.take();
            HuaweiTLV bad = new HuaweiTLV().put(0x01, (byte) 1).put(0x02, dictBytes(500044));
            HuaweiTLV l = new HuaweiTLV().put(0x06, 5L);
            bad.put(0x83, new HuaweiTLV().put(0x84, l));
            manager.handlePacket(response(2, 68, "hw.watch.health.filesync", "hw.unitedevice.datadictionarysync", cat(new byte[] {1}, bad.serialize()), null, false));
            steps.put(step("missing start time", cap.take()).put("events", take(events)));
            root.put("dictionary", steps);

            JSONArray toBytes = GoldenSupport.arr();
            for (int v : new int[] {0, 1, 255, 256, 700004, 500044, 65535, 65536, 16777215, 16777216}) {
                toBytes.put(new JSONArray().put(v).put(GoldenSupport.hex(HuaweiP2PDataDictionarySyncService.dictToBytes(v))));
            }
            root.put("dictToBytes", toBytes);
        }

        // handlers
        {
            JSONArray gates = GoldenSupport.arr();
            HuaweiP2PDataDictionarySyncService svcForHandlers = new HuaweiP2PDataDictionarySyncService(new HuaweiP2PManager(new Capture()));
            List<HuaweiDictionarySyncInterface> handlers = svcForHandlers.getSyncHandlers();
            int[] bits = {14, 29, 59, 72, 75, 107, 113, 168, 206, 235, 255};
            for (HuaweiDictionarySyncInterface h : handlers) {
                JSONObject o = GoldenSupport.obj();
                o.put("class", h.getDataClass()).put("type", h.getMetricType()).put("title", h.getTitle()).put("gate", h.describeGate());
                JSONArray supports = GoldenSupport.arr();
                for (int bit : bits) {
                    final int only = bit;
                    supports.put(new JSONArray().put(bit).put(h.supports(w -> w == only)));
                }
                o.put("supportsOnly", supports);
                o.put("supportsNone", h.supports(w -> false));
                gates.put(o);
            }
            root.put("handlerGates", gates);

            JSONArray cases = GoldenSupport.arr();
            double nan = Double.NaN;
            Object[][] samples = {
                {400012, 400012430, 36.6}, {400012, 400012430, 19.9}, {400012, 400012430, 42.0}, {400012, 400012430, 42.1}, {400012, 400012430, nan},
                {400012, 1, 36.6},
                {500044, 500044831, 45.9}, {500044, 500044831, 200.0}, {500044, 500044831, 200.5}, {500044, 500044831, -1.0},
                {500031, 500031195, 37.0}, {500031, 500031195, 99.9}, {500031, 500031195, 100.0},
                {500031, 500031347, 12.5}, {500031, 500031347, 100.0}, {500031, 500031347, 100.5},
                {500031, 500031160, 5.0}, {500031, 500031842, 80.25},
                {500002, 500002847, 1.0}, {500002, 500002847, 4.7}, {500002, 500002847, 5.0}, {500002, 500002847, nan},
                {400017, 400017001, 3.5}, {200003, 200003001, 1500.0}, {10002, 10002001, 120.0}, {500006, 500006001, 2.0}, {700004, 700004001, 0.5},
            };
            for (Object[] s : samples) {
                int cls = (Integer) s[0];
                int type = (Integer) s[1];
                double v = (Double) s[2];
                cases.put(handlerCase(cls, 1700000000000L, 1700000060000L, 1700000090000L, new HuaweiP2PDataDictionarySyncService.DictData.DictDataValue(type, (byte) 10, doubleBytes(v))));
            }
            // mixed and odd values
            cases.put(handlerCase(500031, 1000, 2000, 0,
                new HuaweiP2PDataDictionarySyncService.DictData.DictDataValue(500031195, (byte) 10, doubleBytes(3)),
                new HuaweiP2PDataDictionarySyncService.DictData.DictDataValue(500031347, (byte) 10, doubleBytes(55.5)),
                new HuaweiP2PDataDictionarySyncService.DictData.DictDataValue(500031160, (byte) 10, doubleBytes(2)),
                new HuaweiP2PDataDictionarySyncService.DictData.DictDataValue(500031842, (byte) 10, doubleBytes(70)),
                new HuaweiP2PDataDictionarySyncService.DictData.DictDataValue(500031999, (byte) 10, doubleBytes(70)),
                new HuaweiP2PDataDictionarySyncService.DictData.DictDataValue(500031195, (byte) 11, "text".getBytes())));
            cases.put(handlerCase(400012, 1000, 0, 0, new HuaweiP2PDataDictionarySyncService.DictData.DictDataValue(400012430, (byte) 10, new byte[] {1, 2, 3})));
            cases.put(handlerCase(400012, 1000, 0, 0, new HuaweiP2PDataDictionarySyncService.DictData.DictDataValue(400012430, (byte) 11, doubleBytes(36.5))));
            cases.put(handlerCase(400017, 1000, 0, 0,
                new HuaweiP2PDataDictionarySyncService.DictData.DictDataValue(1, (byte) 10, doubleBytes(7)),
                new HuaweiP2PDataDictionarySyncService.DictData.DictDataValue(2, (byte) 10, doubleBytes(nan)),
                new HuaweiP2PDataDictionarySyncService.DictData.DictDataValue(3, (byte) 10, new byte[] {0x0a, 0x0b}),
                new HuaweiP2PDataDictionarySyncService.DictData.DictDataValue(4, (byte) 11, "he said \"hi\"\n\u00e9".getBytes(java.nio.charset.StandardCharsets.UTF_8)),
                new HuaweiP2PDataDictionarySyncService.DictData.DictDataValue(5, (byte) 12, new byte[] {(byte) 0xff}),
                new HuaweiP2PDataDictionarySyncService.DictData.DictDataValue(6, (byte) 10, doubleBytes(1.0 / 0.0)),
                new HuaweiP2PDataDictionarySyncService.DictData.DictDataValue(7, (byte) 10, doubleBytes(-0.125))));
            cases.put(handlerCase(400017, 1000, 0, 0));
            root.put("handlerCases", cases);
        }

        GoldenSupport.write(args[0], "p2p.json", root);
    }

    static long lastTs = 0;

    static JSONObject step(String name, JSONArray sent) {
        return GoldenSupport.obj().put("do", name).put("sent", sent);
    }

    static JSONArray take(JSONArray events) {
        JSONArray copy = new JSONArray();
        for (int i = 0; i < events.length(); i++) copy.put(events.get(i));
        while (events.length() > 0) events.remove(0);
        return copy;
    }

    static byte[] cat(byte[] a, byte[] b) {
        byte[] out = new byte[a.length + b.length];
        System.arraycopy(a, 0, out, 0, a.length);
        System.arraycopy(b, 0, out, a.length, b.length);
        return out;
    }

    static byte[] doubleBytes(double v) {
        return java.nio.ByteBuffer.allocate(8).putDouble(v).array();
    }

    static byte[] dictBytes(int v) {
        return HuaweiP2PDataDictionarySyncService.dictToBytes(v);
    }

    /** One answer of the watch: operation, class tag (variable size), entries {start, end, modify} each with one 0xa value of `type`. */
    static byte[] answer(int operation, int dictClass, long[][] entries, int type, double value) {
        HuaweiTLV tlv = new HuaweiTLV().put(0x01, (byte) operation).put(0x02, dictBytes(dictClass));
        HuaweiTLV block = new HuaweiTLV();
        for (long[] e : entries) {
            HuaweiTLV l = new HuaweiTLV().put(0x05, e[0]);
            if (e[1] != 0) l.put(0x06, e[1]);
            if (e[2] != 0) l.put(0x0c, e[2]);
            HuaweiTLV inner = new HuaweiTLV().put(0x09, type).put(0x0a, doubleBytes(value));
            l.put(0x87, new HuaweiTLV().put(0x88, inner));
            block.put(0x84, l);
        }
        if (entries.length > 0) tlv.put(0x83, block);
        return cat(new byte[] {1}, tlv.serialize());
    }

    static JSONObject dumpData(int dictClass, List<HuaweiP2PDataDictionarySyncService.DictData> data) {
        JSONObject o = GoldenSupport.obj();
        o.put("onData", dictClass);
        JSONArray arr = GoldenSupport.arr();
        for (HuaweiP2PDataDictionarySyncService.DictData d : data) {
            JSONObject e = GoldenSupport.obj();
            e.put("start", d.getStartTimestamp()).put("end", d.getEndTimestamp()).put("modify", d.getModifyTimestamp());
            JSONArray values = GoldenSupport.arr();
            for (HuaweiP2PDataDictionarySyncService.DictData.DictDataValue v : d.getData()) {
                values.put(GoldenSupport.obj().put("type", v.getDataType()).put("tag", v.getTag() & 0xFF).put("value", GoldenSupport.hex(v.getValue())));
            }
            e.put("values", values);
            arr.put(e);
        }
        o.put("entries", arr);
        return o;
    }

    static JSONObject handlerCase(int dictClass, long start, long end, long modify, HuaweiP2PDataDictionarySyncService.DictData.DictDataValue... values) {
        HuaweiP2PDataDictionarySyncService.DictData data = new HuaweiP2PDataDictionarySyncService.DictData(dictClass, start, end, modify, List.of(values));
        JSONObject o = dumpData(dictClass, List.of(data));
        HuaweiP2PDataDictionarySyncService svc = new HuaweiP2PDataDictionarySyncService(new HuaweiP2PManager(new Capture()));
        JSONArray rows = GoldenSupport.arr();
        for (HuaweiDictionarySyncInterface h : svc.getSyncHandlers()) {
            if (h.getDataClass() != dictClass) continue;
            List<HuaweiDictionarySyncInterface.Row> captured = new ArrayList<>();
            h.handleData(new HuaweiDictionarySyncInterface.Store() {
                @Override public long getLastFetchTimestamp(String type) { return 0; }
                @Override public void persist(List<HuaweiDictionarySyncInterface.Row> r) { captured.addAll(r); }
            }, List.of(data));
            for (HuaweiDictionarySyncInterface.Row r : captured) {
                JSONObject row = GoldenSupport.obj();
                row.put("type", r.type).put("timestamp", r.timestamp).put("lastTimestamp", r.lastTimestamp);
                row.put("value", r.value == null ? JSONObject.NULL : r.value);
                row.put("valuesJson", new JSONObject(r.valuesJson));
                rows.put(row);
            }
        }
        o.put("rows", rows);
        return o;
    }
}

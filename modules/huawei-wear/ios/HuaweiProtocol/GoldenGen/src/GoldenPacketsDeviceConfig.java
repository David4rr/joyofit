import java.nio.charset.StandardCharsets;
import java.util.Calendar;
import java.util.List;
import java.util.Map;
import java.util.TimeZone;

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiConstants;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiCoordinator.HuaweiDeviceType;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiUtil;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiCrypto;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.AccountRelated;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.DeviceConfig;
import nodomain.freeyourgadget.gadgetbridge.util.CryptoUtils;

import org.json.JSONArray;
import org.json.JSONObject;

/** DeviceConfig (service 0x01) and AccountRelated requests and responses, built and parsed by the real Java classes. */
public class GoldenPacketsDeviceConfig {
    static byte[] b(int... v) {
        byte[] out = new byte[v.length];
        for (int i = 0; i < v.length; i++) out[i] = (byte) v[i];
        return out;
    }

    static JSONObject dumpTz(String zone, long millis) {
        Calendar cal = Calendar.getInstance(TimeZone.getTimeZone(zone));
        cal.setTimeInMillis(millis);
        DeviceConfig.TimeRequest req = new DeviceConfig.TimeRequest(PacketsGoldenKit.params(), cal);
        JSONObject o = GoldenSupport.obj();
        o.put("zone", zone);
        o.put("millis", millis);
        o.put("timeAndZoneId", GoldenSupport.hex(HuaweiUtil.getTimeAndZoneId(cal)));
        o.put("tlv", GoldenSupport.hex(req.getTlv().serialize()));
        return o;
    }

    static void hiChainSteps(JSONArray out, int op) throws Exception {
        HuaweiPacket.ParamsProvider pp = PacketsGoldenKit.params();
        byte[] selfAuthId = PacketsGoldenKit.ascii("ABCDEF0123456789ABCDEF0123456789");
        long requestId = 1700000000123L;
        DeviceConfig.HiChain.Request chain = new DeviceConfig.HiChain.Request(op, requestId, selfAuthId, HuaweiConstants.GROUP_ID);
        byte[] isoSalt = GoldenSupport.bytes(9000 + op, 16);
        byte[] seed = GoldenSupport.bytes(9010 + op, 32);
        byte[] token = GoldenSupport.bytes(9020 + op, 32);
        byte[] nonce = GoldenSupport.bytes(9030 + op, 12);
        byte[] enc = GoldenSupport.bytes(9040 + op, 32);
        HuaweiPacket[] steps = {
            chain.new StepOne(pp, 1, isoSalt, seed),
            chain.new StepTwo(pp, 2, token),
            chain.new StepThree(pp, 3, nonce, enc),
            chain.new StepFour(pp, op == 1 ? 4 : 3, nonce, enc),
        };
        String[] names = {"StepOne", "StepTwo", "StepThree", "StepFour"};
        int[] messageIds = {1, 2, 3, op == 1 ? 4 : 3};
        for (int i = 0; i < steps.length; i++) {
            JSONObject o = GoldenSupport.obj();
            o.put("name", "op" + op + " " + names[i]);
            o.put("step", names[i]);
            o.put("operationCode", op);
            o.put("messageId", messageIds[i]);
            o.put("requestId", requestId);
            o.put("selfAuthId", GoldenSupport.hex(selfAuthId));
            o.put("groupId", HuaweiConstants.GROUP_ID);
            o.put("isoSalt", GoldenSupport.hex(isoSalt));
            o.put("seed", GoldenSupport.hex(seed));
            o.put("token", GoldenSupport.hex(token));
            o.put("nonce", GoldenSupport.hex(nonce));
            o.put("enc", GoldenSupport.hex(enc));
            o.put("service", steps[i].serviceId & 0xFF);
            o.put("command", steps[i].commandId & 0xFF);
            o.put("encrypted", PacketsGoldenKit.flag(steps[i], "isEncrypted"));
            o.put("sliced", PacketsGoldenKit.flag(steps[i], "isSliced"));
            o.put("entries", PacketsGoldenKit.entries(steps[i].getTlv()));
            // The JSON text of tag 0x01, parsed by Swift and compared semantically (org.json jar order is unspecified).
            o.put("json", new String(steps[i].getTlv().getBytes(0x01), StandardCharsets.UTF_8));
            out.put(o);
        }
    }

    static JSONObject hiChainResponse(String name, HuaweiTLV tlv) {
        return PacketsGoldenKit.response(name, 0x01, 0x28, tlv.serialize(), PacketsGoldenKit.params(), (parsed, fields) -> {
            DeviceConfig.HiChain.Response r = (DeviceConfig.HiChain.Response) parsed;
            fields.put("type", (int) r.type);
            fields.put("step", (int) r.step);
            fields.put("errorCode", r.errorCode);
            if (r.step1Data != null) {
                fields.put("step1Data", GoldenSupport.obj()
                    .put("isoSalt", GoldenSupport.hex(r.step1Data.isoSalt))
                    .put("peerAuthId", GoldenSupport.hex(r.step1Data.peerAuthId))
                    .put("peerUserType", r.step1Data.peerUserType)
                    .put("token", GoldenSupport.hex(r.step1Data.token)));
            }
            if (r.step2Data != null) {
                fields.put("step2Data", GoldenSupport.obj().put("returnCodeMac", GoldenSupport.hex(r.step2Data.returnCodeMac)));
            }
            if (r.step3Data != null) {
                fields.put("step3Data", GoldenSupport.obj()
                    .put("nonce", GoldenSupport.hex(r.step3Data.nonce))
                    .put("encAuthToken", GoldenSupport.hex(r.step3Data.encAuthToken)));
            }
            if (r.step4Data != null) {
                fields.put("step4Data", GoldenSupport.obj().put("data", r.step4Data.data == null ? JSONObject.NULL : r.step4Data.data));
            }
        }); 
    }

    static HuaweiTLV classic(String json) {
        return new HuaweiTLV().put(0x01, json).put(0x04, (byte) 0x00);
    }

    public static void main(String[] args) throws Exception {
        JSONObject root = GoldenSupport.obj();
        HuaweiPacket.ParamsProvider pp = PacketsGoldenKit.params();

        // ---------- requests ----------
        JSONArray requests = GoldenSupport.arr();
        requests.put(PacketsGoldenKit.request("LinkParams AW", new DeviceConfig.LinkParams.Request(pp, HuaweiDeviceType.AW)));
        requests.put(PacketsGoldenKit.request("LinkParams BLE", new DeviceConfig.LinkParams.Request(pp, HuaweiDeviceType.BLE)));
        requests.put(PacketsGoldenKit.request("LinkParams BR", new DeviceConfig.LinkParams.Request(pp, HuaweiDeviceType.BR)));
        requests.put(PacketsGoldenKit.request("SupportedServices known", new DeviceConfig.SupportedServices.Request(pp, DeviceConfig.SupportedServices.knownSupportedServices)));
        requests.put(PacketsGoldenKit.request("ProductInfo AW", new DeviceConfig.ProductInfo.Request(pp, HuaweiDeviceType.AW)));
        requests.put(PacketsGoldenKit.request("ProductInfo BLE", new DeviceConfig.ProductInfo.Request(pp, HuaweiDeviceType.BLE)));
        requests.put(PacketsGoldenKit.request("ProductInfo BR", new DeviceConfig.ProductInfo.Request(pp, HuaweiDeviceType.BR)));
        requests.put(PacketsGoldenKit.request("Bond", new DeviceConfig.Bond.Request(pp, PacketsGoldenKit.ascii("ABC123"), GoldenSupport.bytes(100, 32), GoldenSupport.bytes(101, 16))));
        requests.put(PacketsGoldenKit.request("BondParams", new DeviceConfig.BondParams.Request(pp, PacketsGoldenKit.ascii("ABC123"), PacketsGoldenKit.ascii("FF:FF:FF:AB:C1:23"))));
        {
            HuaweiPacket.ParamsProvider p0 = PacketsGoldenKit.params();
            p0.setAuthMode((byte) 0);
            p0.setAuthAlgo((byte) 1);
            requests.put(PacketsGoldenKit.request("Auth authMode 0", new DeviceConfig.Auth.Request(p0, GoldenSupport.bytes(110, 32), GoldenSupport.bytes(111, 18))));
            HuaweiPacket.ParamsProvider p2 = PacketsGoldenKit.params();
            p2.setAuthMode((byte) 2);
            p2.setAuthAlgo((byte) 1);
            requests.put(PacketsGoldenKit.request("Auth authMode 2 algo 1", new DeviceConfig.Auth.Request(p2, GoldenSupport.bytes(112, 32), GoldenSupport.bytes(113, 18))));
            p2.setAuthAlgo((byte) 0x81);
            requests.put(PacketsGoldenKit.request("Auth authMode 2 algo 0x81", new DeviceConfig.Auth.Request(p2, GoldenSupport.bytes(114, 32), GoldenSupport.bytes(115, 18))));
        }
        requests.put(PacketsGoldenKit.request("BatteryLevel", new DeviceConfig.BatteryLevel.Request(pp)));
        requests.put(PacketsGoldenKit.request("DeviceStatus ask", new DeviceConfig.DeviceStatus.Request(pp, true)));
        requests.put(PacketsGoldenKit.request("DeviceStatus notify", new DeviceConfig.DeviceStatus.Request(pp, false)));
        requests.put(PacketsGoldenKit.request("PinCode", new DeviceConfig.PinCode.Request(pp)));
        requests.put(PacketsGoldenKit.request("SettingRelated", new DeviceConfig.SettingRelated.Request(pp)));
        requests.put(PacketsGoldenKit.request("ConnectStatus", new DeviceConfig.ConnectStatusRequest(pp)));
        requests.put(PacketsGoldenKit.request("ExpandCapability", new DeviceConfig.ExpandCapability.Request(pp)));
        requests.put(PacketsGoldenKit.request("WearStatus", new DeviceConfig.WearStatus.Request(pp)));
        requests.put(PacketsGoldenKit.request("SetUpDeviceStatus main", new DeviceConfig.SetUpDeviceStatusRequest(pp, 1, "HUAWEI WATCH FIT 4 Pro-40A")));
        requests.put(PacketsGoldenKit.request("SetUpDeviceStatus empty name", new DeviceConfig.SetUpDeviceStatusRequest(pp, 0, "")));
        requests.put(PacketsGoldenKit.request("SetUpDeviceStatus relationship 300", new DeviceConfig.SetUpDeviceStatusRequest(pp, 300, "Watch \u00e9")));
        requests.put(PacketsGoldenKit.request("ReverseCapabilities", new DeviceConfig.ReverseCapabilities.Request(pp)));
        {
            // SecurityNegotiation: authMode 4 (deviceSupportType 4), 2 (HiChain Lite / classic), 0; encryptMethod 1 adds tag 0x0d.
            byte[] uuid = PacketsGoldenKit.ascii("0123456789ABCDEF0123456789ABCDEF");
            for (int mode : new int[] {4, 2, 0, 1}) {
                for (int method : new int[] {0, 1}) {
                    HuaweiPacket.ParamsProvider p = PacketsGoldenKit.params();
                    p.setEncryptMethod((byte) method);
                    requests.put(PacketsGoldenKit.request("SecurityNegotiation mode " + mode + " method " + method,
                        new DeviceConfig.SecurityNegotiation.Request(p, (byte) mode, uuid, "iPhone17,1")));
                }
            }
        }
        {
            // AccountRelated: SendExtendedAccountToDevice
            for (boolean opt : new boolean[] {false, true}) {
                for (String account : new String[] {"", "user@example.com"}) {
                    requests.put(PacketsGoldenKit.request("ExtendedAccount opt=" + opt + " account=\"" + account + "\"",
                        new AccountRelated.SendExtendedAccountToDevice.Request(pp, opt, account)));
                }
            }
        }
        {
            // AcceptAgreement embeds System.currentTimeMillis(); Swift reads the timestamp back out of this TLV.
            requests.put(PacketsGoldenKit.request("AcceptAgreement", new DeviceConfig.AcceptAgreement.Request(pp)));
        }
        root.put("requests", requests);

        // ---------- SupportedCommands table and request packing ----------
        JSONObject table = GoldenSupport.obj();
        for (Map.Entry<Integer, byte[]> e : DeviceConfig.SupportedCommands.commandsPerService.entrySet()) {
            table.put(Integer.toString(e.getKey()), GoldenSupport.hex(e.getValue()));
        }
        root.put("commandsPerService", table);
        root.put("knownSupportedServices", GoldenSupport.hex(DeviceConfig.SupportedServices.knownSupportedServices));

        JSONArray packing = GoldenSupport.arr();
        for (int slice : new int[] {0xf4, 1022, 200, 100, 40, 20}) {
            HuaweiPacket.ParamsProvider p = PacketsGoldenKit.params();
            p.setSliceSize(slice);
            DeviceConfig.SupportedCommands.Request req = new DeviceConfig.SupportedCommands.Request(p);
            JSONArray accepted = GoldenSupport.arr();
            // Keeps trying after a refusal, to pin the length arithmetic for every service.
            for (Map.Entry<Integer, byte[]> e : DeviceConfig.SupportedCommands.commandsPerService.entrySet()) {
                accepted.put(req.addCommandsForService((byte) (int) e.getKey(), e.getValue()));
            }
            JSONObject o = PacketsGoldenKit.request("SupportedCommands slice " + slice, req);
            o.put("sliceSize", slice);
            o.put("accepted", accepted);
            packing.put(o);
        }
        root.put("supportedCommandsPacking", packing);

        // ---------- TimeRequest ----------
        JSONArray times = GoldenSupport.arr();
        String[] zones = {"UTC", "Asia/Jakarta", "America/New_York", "America/St_Johns", "Asia/Kolkata", "Pacific/Chatham", "Pacific/Kiritimati", "Europe/Berlin", "Asia/Kathmandu", "America/Sao_Paulo", "Pacific/Pago_Pago"};
        long[] instants = {1767225600000L /* 2026-01-01 */, 1782864000000L /* 2026-07-01 */, 1792000000123L};
        for (String zone : zones) for (long ms : instants) times.put(dumpTz(zone, ms));
        root.put("timeRequests", times);

        // ---------- responses ----------
        JSONArray responses = GoldenSupport.arr();

        // LinkParams.Response: the Fit 4 Pro over LE (real values: protocol 2, deviceSupportType 4, authVersion 1, mtu 514, slice 1022).
        byte[] linkNonce = GoldenSupport.bytes(200, 16);
        byte[] link05 = PacketsGoldenKit.cat(b(0x00, 0x01), linkNonce);
        responses.put(PacketsGoldenKit.response("LinkParams real LE", 0x01, 0x01, new HuaweiTLV()
            .put(0x01, (byte) 0x02).put(0x02, (short) 1022).put(0x03, (short) 514).put(0x04, (short) 0)
            .put(0x05, link05).put(0x07, (byte) 0x04).put(0x08, (byte) 0x00).put(0x09, (byte) 0x00).put(0x0C, (byte) 0x00)));
        responses.put(PacketsGoldenKit.response("LinkParams minimal (only 05)", 0x01, 0x01, new HuaweiTLV().put(0x05, link05)));
        responses.put(PacketsGoldenKit.response("LinkParams all optional, gcm", 0x01, 0x01, new HuaweiTLV()
            .put(0x01, (byte) 0xFE).put(0x02, (short) 0xF4F4).put(0x03, (short) -2).put(0x04, (short) 0x0102)
            .put(0x05, PacketsGoldenKit.cat(b(0xAA, 0x83), linkNonce)).put(0x07, (byte) 0x83).put(0x08, (byte) 0x81).put(0x09, (byte) 0x82).put(0x0C, (byte) 0x01)));
        responses.put(PacketsGoldenKit.response("LinkParams 05 longer than 18", 0x01, 0x01, new HuaweiTLV().put(0x05, PacketsGoldenKit.cat(link05, b(1, 2, 3)))));
        responses.put(PacketsGoldenKit.response("LinkParams no 05", 0x01, 0x01, new HuaweiTLV().put(0x01, (byte) 2)));
        responses.put(PacketsGoldenKit.response("LinkParams 05 too short (17)", 0x01, 0x01, new HuaweiTLV().put(0x05, PacketsGoldenKit.cat(b(0, 1), GoldenSupport.bytes(201, 15)))));
        responses.put(PacketsGoldenKit.response("LinkParams 05 empty", 0x01, 0x01, new HuaweiTLV().put(0x05)));
        responses.put(PacketsGoldenKit.response("LinkParams 02 one byte", 0x01, 0x01, new HuaweiTLV().put(0x02, (byte) 7).put(0x05, link05)));
        responses.put(PacketsGoldenKit.response("LinkParams 07 empty", 0x01, 0x01, new HuaweiTLV().put(0x05, link05).put(0x07)));

        // SupportedServices.Response
        responses.put(PacketsGoldenKit.response("SupportedServices", 0x01, 0x02, new HuaweiTLV().put(0x02, b(1, 1, 0, 1, 0, 0, 1))));
        responses.put(PacketsGoldenKit.response("SupportedServices missing", 0x01, 0x02, new HuaweiTLV().put(0x01, b(1))));
        responses.put(PacketsGoldenKit.response("SupportedServices empty", 0x01, 0x02, new HuaweiTLV().put(0x02)));

        // SupportedCommands.Response
        {
            PacketsGoldenKit.Dumper d = (parsed, fields) -> {
                DeviceConfig.SupportedCommands.Response r = (DeviceConfig.SupportedCommands.Response) parsed;
                JSONArray a = GoldenSupport.arr();
                for (DeviceConfig.SupportedCommands.Response.CommandsList l : r.commandsLists) {
                    a.put(GoldenSupport.obj().put("service", l.service).put("commands", GoldenSupport.hex(l.commands)));
                }
                fields.put("commandsLists", a);
            };
            java.util.function.BiFunction<String, HuaweiTLV, JSONObject> sc = (name, container) ->
                PacketsGoldenKit.response(name, 0x01, 0x03, new HuaweiTLV().put(0x81, container).serialize(), PacketsGoldenKit.params(), d);
            responses.put(sc.apply("SupportedCommands two services", new HuaweiTLV()
                .put(0x02, (byte) 0x07).put(0x04, b(1, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1))
                .put(0x02, (byte) 0x02).put(0x04, b(1, 1, 0, 1, 0, 1))));
            responses.put(sc.apply("SupportedCommands service 1 all", new HuaweiTLV()
                .put(0x02, (byte) 0x01).put(0x04, b(1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1))));
            responses.put(sc.apply("SupportedCommands none supported", new HuaweiTLV().put(0x02, (byte) 0x03).put(0x04, b(0, 0, 0))));
            responses.put(sc.apply("SupportedCommands flags other than 0/1", new HuaweiTLV().put(0x02, (byte) 0x03).put(0x04, b(2, 1, 0xFF))));
            responses.put(sc.apply("SupportedCommands shorter list than table", new HuaweiTLV().put(0x02, (byte) 0x07).put(0x04, b(1, 1))));
            responses.put(sc.apply("SupportedCommands empty list", new HuaweiTLV().put(0x02, (byte) 0x04).put(0x04)));
            responses.put(sc.apply("SupportedCommands 04 before 02", new HuaweiTLV().put(0x04, b(1))));
            responses.put(sc.apply("SupportedCommands unknown tag", new HuaweiTLV().put(0x02, (byte) 0x04).put(0x03, b(1))));
            responses.put(sc.apply("SupportedCommands empty container", new HuaweiTLV()));
            responses.put(sc.apply("SupportedCommands only a service tag", new HuaweiTLV().put(0x02, (byte) 0x04)));
            responses.put(sc.apply("SupportedCommands unknown service (0x21)", new HuaweiTLV().put(0x02, (byte) 0x21).put(0x04, b(1))));
            responses.put(sc.apply("SupportedCommands unknown service, no flag set", new HuaweiTLV().put(0x02, (byte) 0x21).put(0x04, b(0))));
            responses.put(sc.apply("SupportedCommands list longer than table", new HuaweiTLV().put(0x02, (byte) 0x04).put(0x04, b(1, 1))));
            responses.put(sc.apply("SupportedCommands longer list, extra zero", new HuaweiTLV().put(0x02, (byte) 0x04).put(0x04, b(1, 0))));
            responses.put(sc.apply("SupportedCommands service tag empty", new HuaweiTLV().put(0x02).put(0x04, b(1))));
            responses.put(sc.apply("SupportedCommands negative service", new HuaweiTLV().put(0x02, (byte) 0x85).put(0x04, b(1))));
            responses.put(sc.apply("SupportedCommands two 04 after one 02", new HuaweiTLV().put(0x02, (byte) 0x03).put(0x04, b(1, 0, 1)).put(0x04, b(0, 1, 1))));
            responses.put(sc.apply("SupportedCommands service tag two bytes", new HuaweiTLV().put(0x02, b(0x03, 0x09)).put(0x04, b(1, 1, 1))));
            responses.put(PacketsGoldenKit.response("SupportedCommands no 0x81", 0x01, 0x03, new HuaweiTLV().put(0x02, (byte) 1).serialize(), PacketsGoldenKit.params(), d));
            responses.put(PacketsGoldenKit.response("SupportedCommands 0x81 malformed nested TLV", 0x01, 0x03, new HuaweiTLV().put(0x81, b(0x02, 0x09, 0x01)).serialize(), PacketsGoldenKit.params(), d));
        }

        // TimeRequest.Response
        responses.put(PacketsGoldenKit.response("TimeResponse with time", 0x01, 0x05, new HuaweiTLV().put(0x01, 1792000000)));
        responses.put(PacketsGoldenKit.response("TimeResponse negative time", 0x01, 0x05, new HuaweiTLV().put(0x01, -5)));
        responses.put(PacketsGoldenKit.response("TimeResponse without time", 0x01, 0x05, new HuaweiTLV().put(0x02, (short) 1)));
        responses.put(PacketsGoldenKit.response("TimeResponse short time", 0x01, 0x05, new HuaweiTLV().put(0x01, b(1, 2))));
        responses.put(PacketsGoldenKit.response("TimeResponse long time", 0x01, 0x05, new HuaweiTLV().put(0x01, b(1, 2, 3, 4, 5, 6))));

        // ProductInfo.Response
        responses.put(PacketsGoldenKit.response("ProductInfo full", 0x01, 0x07, new HuaweiTLV()
            .put(0x03, "1.0.0.5").put(0x07, "6.1.0.117(SP20C00M05)").put(0x09, "ABCD1234").put(0x0A, "  SYA-B29\u0000 \n")
            .put(0x0F, "com.huawei.watch").put(0x11, "HUAWEI WATCH FIT 4 Pro-40A").put(0x14, (byte) 0x07).put(0x27, (short) 0x0200)));
        responses.put(PacketsGoldenKit.response("ProductInfo required only", 0x01, 0x07, new HuaweiTLV().put(0x07, "fw").put(0x0A, "model")));
        responses.put(PacketsGoldenKit.response("ProductInfo no model", 0x01, 0x07, new HuaweiTLV().put(0x07, "fw")));
        responses.put(PacketsGoldenKit.response("ProductInfo no software", 0x01, 0x07, new HuaweiTLV().put(0x0A, "model")));
        responses.put(PacketsGoldenKit.response("ProductInfo region 4 bytes", 0x01, 0x07, new HuaweiTLV().put(0x07, "fw").put(0x0A, "m").put(0x14, 5).put(0x27, -3)));
        responses.put(PacketsGoldenKit.response("ProductInfo region 3 bytes", 0x01, 0x07, new HuaweiTLV().put(0x07, "fw").put(0x0A, "m").put(0x14, b(1, 2, 3))));
        responses.put(PacketsGoldenKit.response("ProductInfo region empty", 0x01, 0x07, new HuaweiTLV().put(0x07, "fw").put(0x0A, "m").put(0x14)));
        responses.put(PacketsGoldenKit.response("ProductInfo region 6 bytes", 0x01, 0x07, new HuaweiTLV().put(0x07, "fw").put(0x0A, "m").put(0x14, b(0, 0, 1, 2, 3, 4))));
        responses.put(PacketsGoldenKit.response("ProductInfo region 2 bytes unsigned", 0x01, 0x07, new HuaweiTLV().put(0x07, "fw").put(0x0A, "m").put(0x14, b(0xFF, 0xFE)).put(0x27, b(0xFF))));
        responses.put(PacketsGoldenKit.response("ProductInfo utf8", 0x01, 0x07, new HuaweiTLV().put(0x07, "v\u00e9r").put(0x0A, "\u624b\u8868").put(0x11, "\u2603")));

        // BondParams.Response
        responses.put(PacketsGoldenKit.response("BondParams", 0x01, 0x0F, new HuaweiTLV().put(0x01, (byte) 1).put(0x09, 41)));
        responses.put(PacketsGoldenKit.response("BondParams counter high bit", 0x01, 0x0F, new HuaweiTLV().put(0x01, (byte) 0xFF).put(0x09, 0xFFFFFFF0)));
        responses.put(PacketsGoldenKit.response("BondParams no status", 0x01, 0x0F, new HuaweiTLV().put(0x09, 1)));
        responses.put(PacketsGoldenKit.response("BondParams no counter", 0x01, 0x0F, new HuaweiTLV().put(0x01, (byte) 1)));
        responses.put(PacketsGoldenKit.response("BondParams short counter", 0x01, 0x0F, new HuaweiTLV().put(0x01, (byte) 1).put(0x09, b(1, 2, 3))));

        // Auth.Response
        responses.put(PacketsGoldenKit.response("Auth response", 0x01, 0x13, new HuaweiTLV().put(0x01, GoldenSupport.bytes(300, 32))));
        responses.put(PacketsGoldenKit.response("Auth response missing", 0x01, 0x13, new HuaweiTLV().put(0x02, b(1))));

        // BatteryLevel.Response (08 and the 27 push share the class)
        responses.put(PacketsGoldenKit.response("Battery level only", 0x01, 0x08, new HuaweiTLV().put(0x01, (byte) 71)));
        responses.put(PacketsGoldenKit.response("Battery level 100 multi", 0x01, 0x08, new HuaweiTLV().put(0x01, (byte) 100).put(0x02, b(88, 90)).put(0x03, b(1, 0))));
        responses.put(PacketsGoldenKit.response("Battery push 27", 0x01, 0x27, new HuaweiTLV().put(0x01, (byte) 0xC8).put(0x03, b(2))));
        responses.put(PacketsGoldenKit.response("Battery empty multi", 0x01, 0x08, new HuaweiTLV().put(0x01, (byte) 5).put(0x02)));
        responses.put(PacketsGoldenKit.response("Battery no level", 0x01, 0x08, new HuaweiTLV().put(0x02, b(5))));
        responses.put(PacketsGoldenKit.response("Battery empty level", 0x01, 0x08, new HuaweiTLV().put(0x01)));

        // DeviceStatus.Response
        responses.put(PacketsGoldenKit.response("DeviceStatus 1", 0x01, 0x16, new HuaweiTLV().put(0x01, (byte) 1)));
        responses.put(PacketsGoldenKit.response("DeviceStatus -1", 0x01, 0x16, new HuaweiTLV().put(0x01, (byte) 0xFF)));
        responses.put(PacketsGoldenKit.response("DeviceStatus absent", 0x01, 0x16, new HuaweiTLV().put(0x02, (byte) 1)));
        responses.put(PacketsGoldenKit.response("DeviceStatus empty value", 0x01, 0x16, new HuaweiTLV().put(0x01)));

        // PinCode.Response: 64 bytes of pin, AES-CBC under DIGEST_SECRET_v1 (authVersion 1), 16 byte IV: 80 bytes of ciphertext.
        {
            byte[] pin = GoldenSupport.bytes(400, 64);
            byte[] iv = GoldenSupport.bytes(401, 16);
            byte[] cipher = CryptoUtils.encryptAES_CBC_Pad(pin, HuaweiCrypto.DIGEST_SECRET_v1, iv);
            JSONObject o = GoldenSupport.obj();
            o.put("pin", GoldenSupport.hex(pin));
            o.put("iv", GoldenSupport.hex(iv));
            o.put("cipher", GoldenSupport.hex(cipher));
            root.put("pinCodeVector", o);
            for (int version : new int[] {1, 2, 3}) {
                HuaweiPacket.ParamsProvider p = PacketsGoldenKit.params();
                p.setAuthVersion((byte) version);
                byte[] c = CryptoUtils.encryptAES_CBC_Pad(pin, version == 1 ? HuaweiCrypto.DIGEST_SECRET_v1 : version == 2 ? HuaweiCrypto.DIGEST_SECRET_v2 : HuaweiCrypto.DIGEST_SECRET_v3, iv);
                JSONObject r = PacketsGoldenKit.response("PinCode authVersion " + version, 0x01, 0x2C, new HuaweiTLV().put(0x01, c).put(0x02, iv).serialize(), p, null);
                r.put("authVersion", version);
                responses.put(r);
            }
            HuaweiPacket.ParamsProvider gcm = PacketsGoldenKit.params();
            gcm.setAuthVersion((byte) 1);
            gcm.setEncryptMethod((byte) 1);
            byte[] gcmCipher = CryptoUtils.encryptAES_GCM_NoPad(pin, HuaweiCrypto.DIGEST_SECRET_v1, iv, null);
            JSONObject g = PacketsGoldenKit.response("PinCode gcm", 0x01, 0x2C, new HuaweiTLV().put(0x01, gcmCipher).put(0x02, iv).serialize(), gcm, null);
            g.put("authVersion", 1);
            g.put("encryptMethod", 1);
            responses.put(g);
            HuaweiPacket.ParamsProvider bad = PacketsGoldenKit.params();
            bad.setAuthVersion((byte) 1);
            JSONObject wrongKey = PacketsGoldenKit.response("PinCode garbage cipher", 0x01, 0x2C, new HuaweiTLV().put(0x01, GoldenSupport.bytes(402, 32)).put(0x02, iv).serialize(), bad, null);
            wrongKey.put("authVersion", 1);
            responses.put(wrongKey);
            JSONObject shortCipher = PacketsGoldenKit.response("PinCode cipher not a block multiple", 0x01, 0x2C, new HuaweiTLV().put(0x01, GoldenSupport.bytes(403, 17)).put(0x02, iv).serialize(), bad, null);
            shortCipher.put("authVersion", 1);
            responses.put(shortCipher);
            JSONObject noIv = PacketsGoldenKit.response("PinCode no iv", 0x01, 0x2C, new HuaweiTLV().put(0x01, cipher).serialize(), bad, null);
            noIv.put("authVersion", 1);
            responses.put(noIv);
            JSONObject badIv = PacketsGoldenKit.response("PinCode iv 3 bytes", 0x01, 0x2C, new HuaweiTLV().put(0x01, cipher).put(0x02, b(1, 2, 3)).serialize(), bad, null);
            badIv.put("authVersion", 1);
            responses.put(badIv);
        }

        // SettingRelated.Response (bits of tag 0x02)
        for (int v : new int[] {0, 1, 2, 4, 8, 6, 14, 0xFE, 0xFF}) {
            responses.put(PacketsGoldenKit.response("SettingRelated tag02=" + v, 0x01, 0x31, new HuaweiTLV().put(0x01, (byte) 1).put(0x02, (byte) v)));
        }
        responses.put(PacketsGoldenKit.response("SettingRelated without 02", 0x01, 0x31, new HuaweiTLV().put(0x01, (byte) 1)));
        responses.put(PacketsGoldenKit.response("SettingRelated empty 02", 0x01, 0x31, new HuaweiTLV().put(0x02)));

        // SecurityNegotiation.Response
        {
            // Real wire values of the Fit 4 Pro over LE (PairingProbe, 2026-10-16): 01=04 02=pairType 03=01 04=00 05=64 hex chars 06=18 zeros 07= 08=00 09=MAC\0 0a=00000000.
            byte[] authId = PacketsGoldenKit.ascii("5B3F0A1C77D2E9486AB0C3D41E5F6071829A3B4C5D6E7F8091A2B3C4D5E6F708");
            byte[] mac = PacketsGoldenKit.ascii("30:A9:98:FC:64:0A\0");
            for (int pairType : new int[] {2, 1}) {
                responses.put(PacketsGoldenKit.response("SecurityNegotiation real authMode 4 pairType " + pairType, 0x01, 0x33, new HuaweiTLV()
                    .put(0x01, (byte) 0x04).put(0x02, (byte) pairType).put(0x03, (byte) 0x01).put(0x04, (byte) 0x00)
                    .put(0x05, authId).put(0x06, new byte[18]).put(0x07).put(0x08, (byte) 0x00).put(0x09, mac).put(0x0A, new byte[4])));
            }
            int[] t01 = {-1, 0, 1, 2, 4, 0xFF};
            int[] t02 = {-1, 0, 1, 2, 3, 5, 0xFF};
            int[] t7f = {-1, 3, 0xFF};
            for (int a : t01) for (int c : t02) for (int d : t7f) {
                HuaweiTLV t = new HuaweiTLV();
                if (a != -1) t.put(0x01, (byte) a);
                if (c != -1) t.put(0x02, (byte) c);
                if (d != -1) t.put(0x7F, (byte) d);
                responses.put(PacketsGoldenKit.response("SecurityNegotiation 01=" + a + " 02=" + c + " 7f=" + d, 0x01, 0x33, t));
            }
            responses.put(PacketsGoldenKit.response("SecurityNegotiation with nonce", 0x01, 0x33, new HuaweiTLV().put(0x01, (byte) 1).put(0x03, GoldenSupport.bytes(500, 16))));
            responses.put(PacketsGoldenKit.response("SecurityNegotiation empty tag 01", 0x01, 0x33, new HuaweiTLV().put(0x01)));
            responses.put(PacketsGoldenKit.response("SecurityNegotiation empty tag 02", 0x01, 0x33, new HuaweiTLV().put(0x01, (byte) 4).put(0x02)));
            responses.put(PacketsGoldenKit.response("SecurityNegotiation empty tag 7f", 0x01, 0x33, new HuaweiTLV().put(0x7F)));
        }

        // ExpandCapability.Response, WearStatus.Response, ReverseCapabilities.Response
        responses.put(PacketsGoldenKit.response("ExpandCapability", 0x01, 0x37, new HuaweiTLV().put(0x01, GoldenSupport.bytes(600, 30))));
        responses.put(PacketsGoldenKit.response("ExpandCapability none", 0x01, 0x37, new HuaweiTLV().put(0x02, b(1))));
        responses.put(PacketsGoldenKit.response("ExpandCapability empty", 0x01, 0x37, new HuaweiTLV().put(0x01)));
        responses.put(PacketsGoldenKit.response("WearStatus", 0x01, 0x3D, new HuaweiTLV().put(0x01, (byte) 1)));
        responses.put(PacketsGoldenKit.response("ReverseCapabilities", 0x01, 0x3F, new HuaweiTLV().put(0x01, (byte) 1)));

        // HiChain.Response (classic framing, tag 0x04)
        String iso = "{\"authForm\":0,\"message\":2,\"payload\":{\"isoSalt\":\"00112233445566778899AABBCCDDEEFF\",\"peerAuthId\":\"41424344\",\"peerUserType\":0,\"token\":\"AABBCC\",\"version\":{\"currentVersion\":\"2.0.16\",\"minVersion\":\"1.0.0\"}}}";
        responses.put(hiChainResponse("HiChain step1", classic(iso)));
        responses.put(hiChainResponse("HiChain step1 lowercase hex and errorCode 0", classic(iso.replace("\"peerUserType\":0", "\"peerUserType\":0,\"errorCode\":0").replace("AABBCC", "aabbcc"))));
        responses.put(hiChainResponse("HiChain step1 errorCode 4", classic(iso.replace("\"peerUserType\":0", "\"peerUserType\":0,\"errorCode\":4"))));
        responses.put(hiChainResponse("HiChain step1 missing peerUserType", classic(iso.replace("\"peerUserType\":0,", ""))));
        responses.put(hiChainResponse("HiChain step1 missing token", classic(iso.replace("\"token\":\"AABBCC\",", ""))));
        responses.put(hiChainResponse("HiChain step1 empty hex", classic(iso.replace("AABBCC", ""))));
        responses.put(hiChainResponse("HiChain step1 odd hex", classic(iso.replace("AABBCC", "AABBC"))));
        responses.put(hiChainResponse("HiChain step1 hex with spaces", classic(iso.replace("AABBCC", "AA ZZ"))));
        responses.put(hiChainResponse("HiChain step1 invalid hex digits", classic(iso.replace("AABBCC", "AAZZ"))));
        responses.put(hiChainResponse("HiChain step1 mixed case hex", classic(iso.replace("AABBCC", "aAbBcC"))));
        responses.put(hiChainResponse("HiChain step2", classic("{\"message\":2,\"payload\":{\"returnCodeMac\":\"0F0E0D0C\"}}")));
        responses.put(hiChainResponse("HiChain step2 empty mac", classic("{\"payload\":{\"returnCodeMac\":\"\"}}")));
        responses.put(hiChainResponse("HiChain step3", classic("{\"payload\":{\"nonce\":\"000102030405060708090A0B\",\"encAuthToken\":\"A0A1A2A3\"}}")));
        responses.put(hiChainResponse("HiChain step3 missing nonce", classic("{\"payload\":{\"encAuthToken\":\"A0A1A2A3\"}}")));
        responses.put(hiChainResponse("HiChain payload has isoSalt and returnCodeMac", classic("{\"payload\":{\"isoSalt\":\"00\",\"peerAuthId\":\"11\",\"peerUserType\":1,\"token\":\"22\",\"returnCodeMac\":\"33\"}}")));
        responses.put(hiChainResponse("HiChain only errorCode", classic("{\"payload\":{\"errorCode\":3}}")));
        responses.put(hiChainResponse("HiChain no recognised key", classic("{\"payload\":{\"other\":1}}")));
        responses.put(hiChainResponse("HiChain no payload", classic("{\"message\":1}")));
        responses.put(hiChainResponse("HiChain payload not an object", classic("{\"payload\":5}")));
        responses.put(hiChainResponse("HiChain not json", classic("not json at all")));
        responses.put(hiChainResponse("HiChain empty json string", classic("")));
        responses.put(hiChainResponse("HiChain errorCode not a number", classic("{\"payload\":{\"errorCode\":\"x\"}}")));
        responses.put(hiChainResponse("HiChain no tag 01 with type 0", new HuaweiTLV().put(0x04, (byte) 0x00)));
        responses.put(hiChainResponse("HiChain type 1 with data", new HuaweiTLV().put(0x01, "plain data").put(0x04, (byte) 0x01)));
        responses.put(hiChainResponse("HiChain type 2 without data", new HuaweiTLV().put(0x04, (byte) 0x02)));
        responses.put(hiChainResponse("HiChain type negative", new HuaweiTLV().put(0x01, "x").put(0x04, (byte) 0xFF)));
        responses.put(hiChainResponse("HiChain empty type", new HuaweiTLV().put(0x01, "x").put(0x04)));
        root.put("responses", responses);

        // ---------- HiChain requests ----------
        JSONArray hichain = GoldenSupport.arr();
        hiChainSteps(hichain, 1);
        hiChainSteps(hichain, 2);
        root.put("hiChainRequests", hichain);

        GoldenSupport.write(args[0], "packetsDeviceConfig.json", root);
    }
}

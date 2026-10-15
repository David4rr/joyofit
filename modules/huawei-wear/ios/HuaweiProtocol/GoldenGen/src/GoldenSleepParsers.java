import java.lang.reflect.Field;
import java.nio.ByteBuffer;
import java.nio.ByteOrder;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiDictTypes;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiSequenceDataFileParser;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTrueSleepSequenceDataParser;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTruSleepParser;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The sleep file parsers (HuaweiTruSleepParser, HuaweiSequenceDataFileParser, HuaweiTrueSleepSequenceDataParser) on the real
 * watch bytes of TestHuaweiTruSleepParser.java, on hand-made files and on seeded mutations; plus the per-record parse results
 * SleepSync.parseSequenceFile consumes.
 */
public class GoldenSleepParsers {
    static String hex(byte[] b) {
        return GoldenSupport.hex(b);
    }

    static byte[] unhex(String s) {
        return GoldenSupport.unhex(s);
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

    static byte[] be(long v, int n) {
        byte[] b = new byte[n];
        for (int i = 0; i < n; i++) b[i] = (byte) (v >> (8 * (n - 1 - i)));
        return b;
    }

    static byte[] le(long v, int n) {
        byte[] b = new byte[n];
        for (int i = 0; i < n; i++) b[i] = (byte) (v >> (8 * i));
        return b;
    }

    static JSONObject error(Throwable e) {
        return GoldenSupport.obj().put("error", e.getClass().getSimpleName());
    }

    /** Seeded mutations: flipped bytes, truncations, insertions. */
    static List<byte[]> mutations(byte[] base, long seed, int count) {
        Random r = new Random(seed);
        List<byte[]> out = new ArrayList<>();
        for (int i = 0; i < count; i++) {
            byte[] b = base.clone();
            switch (r.nextInt(5)) {
                case 0: // flip a few bytes
                    for (int k = 0, n = 1 + r.nextInt(3); k < n && b.length > 0; k++) b[r.nextInt(b.length)] = (byte) r.nextInt(256);
                    break;
                case 1: // truncate
                    b = java.util.Arrays.copyOf(b, r.nextInt(b.length + 1));
                    break;
                case 2: // extreme values at a position
                    if (b.length > 0) b[r.nextInt(b.length)] = (byte) new int[] {0, 1, 0x7f, 0x80, 0xaa, 0xbb, 0xff}[r.nextInt(7)];
                    break;
                case 3: { // insert garbage
                    int at = b.length == 0 ? 0 : r.nextInt(b.length + 1);
                    byte[] ins = new byte[1 + r.nextInt(4)];
                    r.nextBytes(ins);
                    b = cat(java.util.Arrays.copyOfRange(b, 0, at), ins, java.util.Arrays.copyOfRange(b, at, b.length));
                    break;
                }
                default: // prepend padding or tag bytes
                    b = cat(new byte[r.nextInt(4)], new byte[] {(byte) (1 + r.nextInt(2))}, b);
            }
            out.add(b);
        }
        return out;
    }

    // ---- HuaweiTruSleepParser

    static JSONArray truSleepState() {
        JSONArray out = GoldenSupport.arr();
        List<byte[]> inputs = new ArrayList<>();
        inputs.add(unhex("0100000002000000000000000000000003000000050000000000000000000000")); // TestHuaweiTruSleepParser
        inputs.add(new byte[0]);
        inputs.add(new byte[15]);
        inputs.add(new byte[16]);
        inputs.add(new byte[17]);
        inputs.add(new byte[31]);
        inputs.add(new byte[32]);
        inputs.add(cat(le(1700000000, 4), le(1700030000, 4), new byte[] {1, 0, 7, 0, 0, 0, 0, 0}, le(-5, 4), le(0x80000000L, 4), new byte[8]));
        inputs.add(cat(le(1700000000, 4), le(1700030000, 4), GoldenSupport.bytes(6000, 8), le(1700040000, 4), le(1700050000, 4), GoldenSupport.bytes(6001, 8), GoldenSupport.bytes(6002, 5)));
        for (byte[] in : inputs) {
            JSONObject o = GoldenSupport.obj().put("input", hex(in));
            try {
                HuaweiTruSleepParser.TruSleepStatus[] r = HuaweiTruSleepParser.parseState(in);
                JSONArray a = GoldenSupport.arr();
                for (HuaweiTruSleepParser.TruSleepStatus s : r) a.put(GoldenSupport.arr().put(s.startTime).put(s.endTime));
                o.put("result", a);
                o.put("toString", r.length > 0 ? r[0].toString() : JSONObject.NULL);
            } catch (Exception e) {
                o.put("result", error(e));
            }
            out.put(o);
        }
        return out;
    }

    static JSONObject truSleepDataResult(byte[] in) {
        try {
            HuaweiTruSleepParser.TruSleepData d = HuaweiTruSleepParser.parseData(in);
            JSONArray acc = GoldenSupport.arr();
            for (HuaweiTruSleepParser.TruSleepDataAcc a : d.dataACCs) acc.put(GoldenSupport.arr().put(a.startTime).put((int) a.flags));
            JSONArray ppg = GoldenSupport.arr();
            for (HuaweiTruSleepParser.TruSleepDataPpg p : d.dataPPGs) ppg.put(GoldenSupport.arr().put(p.startTime).put((int) p.flags));
            return GoldenSupport.obj().put("acc", acc).put("ppg", ppg);
        } catch (Exception e) {
            return error(e);
        }
    }

    static JSONArray truSleepData() {
        JSONArray out = GoldenSupport.arr();
        List<byte[]> inputs = new ArrayList<>();
        // the inputs of TestHuaweiTruSleepParser (real watch bytes, as GB's own expectations)
        String[] real = {
            "02B000403B0B672AAADA13C109A915E707BE130C06E3112104F80F84182F0888109900390805121004850E4317EC07C911D4037610C701580E2A02310F6B022B100E0448119B075B154F099916390A07191A0E9B00D10E2D02A7105405AAE8FDE8FDBDDA92B767943B71104EE52AB907EE06AC08BD06BE067C07DB06CC05E2079B06C206E906920639063807E0056406D905E2067807870660074D03720A8406AA0624064005CA07DF062D088706D2084B0A00",
            "027500F61E0B6724BB0C016968685756585753545050535354565B595B5B5B5F5C5A5E5B61635D5E5B5756585656AADD401138452F7826FC1D61221F27DD2BFC1A7B248B11260A7A221E1C9128FE185025C827D41C1B206223E31B73126210EC22B620D212B232DC0A93115A322E279B116717F30E2E1500",
            "025A00B2180B671BBB410174706A726F6D6D747B757B776E6E6D6E6F777D77777670757570AA543D0E52276956406837B63C103EB22C6929C7265326EA2FCC2F743CC9380239673B9739EA2FC92CC526BB2E652D6433DD3506397E2F00",
            "0107F02A0B670000B6",
            "000107F02A0B670000B6",
            "00000000000107F02A0B670000B6",
            "0105F02A0B670000B6",
            "0100F02A0B670000B6",
            "0108F02A0B670000B6",
            "027600F61E0B6724BB0C016968685756585753545050535354565B595B5B5B5F5C5A5E5B61635D5E5B5756585656AADD401138452F7826FC1D61221F27DD2BFC1A7B248B11260A7A221E1C9128FE185025C827D41C1B206223E31B73126210EC22B620D212B232DC0A93115A322E279B116717F30E2E1500",
            "027500F61E0B6723BB0C016968685756585753545050535354565B595B5B5B5F5C5A5E5B61635D5E5B5756585656AADD401138452F7826FC1D61221F27DD2BFC1A7B248B11260A7A221E1C9128FE185025C827D41C1B206223E31B73126210EC22B620D212B232DC0A93115A322E279B116717F30E2E1500",
            "025A00B2180B671BCC410174706A726F6D6D747B757B776E6E6D6E6F777D77777670757570AA543D0E52276956406837B63C103EB22C6929C7265326EA2FCC2F743CC9380239673B9739EA2FC92CC526BB2E652D6433DD3506397E2F00",
            "025A00B2180B671BBB410174706A726F6D6D747B757B776E6E6D6E6F777D77777670757570DD543D0E52276956406837B63C103EB22C6929C7265326EA2FCC2F743CC9380239673B9739EA2FC92CC526BB2E652D6433DD3506397E2F00",
            "025A00B2180B671BBB410FFFFFFA726F6D6D747B757B776E6E6D6E6F777D77777670757570AA543D0E52276956406837B63C103EB22C6929C7265326EA2FCC2F743CC9380239673B9739EA2FC92CC526BB2E652D6433DD3506397E2F00",
        };
        for (String s : real) inputs.add(unhex(s));
        byte[] acc = unhex("0107F02A0B670000B6");
        byte[] ppgA = unhex(real[1]);
        byte[] ppgB = unhex(real[2]);
        // interleaved ACC and PPG with padding between, as the watch writes them
        inputs.add(cat(new byte[3], acc, ppgA.length > 0 ? java.util.Arrays.copyOfRange(ppgA, 0, 3 + 0x75) : ppgA, new byte[2], acc, java.util.Arrays.copyOfRange(ppgB, 0, 3 + 0x5a)));
        // lengths that are negative as a Java byte / short: GB's `new byte[length]` throws
        inputs.add(new byte[] {1, (byte) 0x80, 1, 2, 3});
        inputs.add(new byte[] {1, (byte) 0xff});
        inputs.add(new byte[] {2, 0, (byte) 0x80, 1, 2, 3});
        inputs.add(new byte[] {2, (byte) 0xff, (byte) 0xff, 1, 2, 3});
        inputs.add(new byte[] {2, 0x00, 0x40, 1, 2, 3}); // length beyond the data
        inputs.add(new byte[] {2, 0x00}); // half a length
        inputs.add(new byte[] {1}); // tag without length
        inputs.add(new byte[] {1, 0}); // zero-length ACC
        inputs.add(new byte[] {2, 0, 0}); // zero-length PPG
        inputs.add(new byte[] {2, 4, 0, 1, 2, 3, 4}); // PPG with only a timestamp
        inputs.add(new byte[] {2, 5, 0, 1, 2, 3, 4, 0}); // PPG with count 0
        // PPG with count byte negative (> 127 as unsigned) and the extremes of the compressed forms
        for (int count : new int[] {0x80, 0x81, 0xff, 0x7f, 0x01, 0x02, 0x03}) {
            for (int tag : new int[] {0xaa, 0xbb}) {
                byte[] body = cat(le(1700000000, 4), new byte[] {(byte) count}, new byte[] {(byte) tag}, GoldenSupport.bytes(6100 + count + tag, 260));
                inputs.add(cat(new byte[] {2}, le(body.length, 2), body));
            }
        }
        // hand-built PPG packets: raw/raw, comp/raw, raw/comp, comp/comp with restarts and wrap-around deltas
        inputs.add(ppg(5, raw(10, 20, 30, 40, 50), raw(1, 2, 3, 4, 5)));
        inputs.add(ppg(5, comp(1000, new int[] {5, -3, 0xff, 0x7f, 0x80}, new int[] {500, -2}), raw(1, 2, 3, 4, 5)));
        inputs.add(ppg(4, raw(32767, -32768, 0, 1), compAmp(100, new int[] {1, 2, 0xff, 3}, new int[] {1000})));
        inputs.add(ppg(4, comp(32767, new int[] {100, 100, 100}, new int[0]), compAmp(-7, new int[] {1, 2, 3, 4}, new int[0])));
        inputs.add(ppg(4, comp(1, new int[] {1, 2, 0xff, 3}, new int[] {7}), compAmp(-7, new int[] {1, 2, 0xff, 4}, new int[] {-32768})));
        inputs.add(ppg(3, comp(1, new int[] {1, 2}, new int[0]), compAmp(0, new int[] {1, 2, 3}, new int[0])));
        inputs.add(ppg(3, comp(1, new int[] {1, 2}, new int[0]), compAmp(0, new int[] {1, 2}, new int[0])));
        inputs.add(ppg(2, raw(1, 2), raw(1)));

        List<byte[]> fuzz = new ArrayList<>();
        for (int i = 0; i < inputs.size() && i < 22; i++) fuzz.addAll(mutations(inputs.get(i), 6200 + i, 12));
        inputs.addAll(fuzz);

        for (byte[] in : inputs) {
            out.put(GoldenSupport.obj().put("input", hex(in)).put("result", truSleepDataResult(in)));
        }
        return out;
    }

    static byte[] raw(int... shorts) {
        byte[] b = new byte[1 + 2 * shorts.length];
        b[0] = (byte) 0xaa;
        for (int i = 0; i < shorts.length; i++) System.arraycopy(le(shorts[i], 2), 0, b, 1 + 2 * i, 2);
        return b;
    }

    /** Compressed peak: tag, first short, then one delta byte per remaining count (0xff followed by a raw short restarts). */
    static byte[] comp(int first, int[] deltas, int[] restarts) {
        byte[] b = cat(new byte[] {(byte) 0xbb}, le(first, 2));
        int r = 0;
        for (int d : deltas) {
            b = cat(b, new byte[] {(byte) d});
            if ((d & 0xff) == 0xff) b = cat(b, le(r < restarts.length ? restarts[r++] : 0, 2));
        }
        return b;
    }

    /** Compressed amplitude: tag, offset short, then one byte per element (0xff followed by a raw short restarts). */
    static byte[] compAmp(int offset, int[] bytes, int[] restarts) {
        byte[] b = cat(new byte[] {(byte) 0xbb}, le(offset, 2));
        int r = 0;
        for (int d : bytes) {
            b = cat(b, new byte[] {(byte) d});
            if ((d & 0xff) == 0xff) b = cat(b, le(r < restarts.length ? restarts[r++] : 0, 2));
        }
        return b;
    }

    static byte[] ppg(int count, byte[] peak, byte[] amp) {
        byte[] body = cat(le(1700000000, 4), new byte[] {(byte) count}, peak, amp);
        return cat(new byte[] {2}, le(body.length, 2), body);
    }

    // ---- HuaweiSequenceDataFileParser

    static byte[] seqRecord(int start, int end, int version, int summaryType, Integer summaryLenOverride, Integer detailLenOverride, byte[] summary, byte[] details) {
        int summaryLen = summaryLenOverride != null ? summaryLenOverride : summary.length;
        int detailLen = detailLenOverride != null ? detailLenOverride : details.length;
        return cat(be(start, 4), be(end, 4), new byte[] {(byte) version, (byte) summaryType}, be(summaryLen, 2), be(detailLen, 4), GoldenSupport.bytes(6300 + start, 16), summary, details);
    }

    static byte[] seqFile(int dictId, int fileType, int fileVersion, byte[]... records) {
        byte[] body = cat(records);
        return cat(be(body.length, 4), be(dictId, 4), be(fileType, 2), be(fileVersion, 2), GoldenSupport.bytes(6400 + dictId, 20), body);
    }

    static JSONObject seqFileResult(byte[] in) {
        try {
            HuaweiSequenceDataFileParser.SequenceFileData f = HuaweiSequenceDataFileParser.parseSequenceFileData(in);
            if (f == null) return GoldenSupport.obj().put("null", true);
            JSONObject o = GoldenSupport.obj();
            o.put("dictId", f.getDictId()).put("fileType", f.getFileType()).put("fileVersion", f.getFileVersion());
            o.put("toString", f.toString());
            JSONArray recs = GoldenSupport.arr();
            for (HuaweiSequenceDataFileParser.SequenceData sd : f.getSequenceDataList()) {
                recs.put(GoldenSupport.obj().put("start", sd.getStartTime()).put("end", sd.getEndTime()).put("version", sd.getDataVersion())
                        .put("summaryType", sd.getSummaryType()).put("summary", sd.getSummary() == null ? JSONObject.NULL : hex(sd.getSummary()))
                        .put("details", sd.getDetails() == null ? JSONObject.NULL : hex(sd.getDetails())));
            }
            o.put("records", recs);
            return o;
        } catch (Exception e) {
            return error(e);
        }
    }

    static JSONArray sequenceFiles() {
        JSONArray out = GoldenSupport.arr();
        List<byte[]> inputs = new ArrayList<>();
        byte[] sum = GoldenSupport.bytes(6500, 40);
        byte[] det = GoldenSupport.bytes(6501, 24);
        inputs.add(new byte[0]);
        inputs.add(new byte[31]);
        inputs.add(new byte[32]);
        inputs.add(seqFile(700013, 1, 1));
        inputs.add(seqFile(700013, 1, 1, seqRecord(100, 200, 1, 2, null, null, sum, det)));
        inputs.add(seqFile(700013, -2, -3, seqRecord(-100, 200, -1, -2, null, null, sum, det)));
        inputs.add(seqFile(700013, 1, 1, seqRecord(100, 200, 1, 2, null, null, sum, det), seqRecord(300, 400, 1, 2, null, null, sum, det), seqRecord(500, 600, 1, 1, null, null, sum, new byte[0])));
        inputs.add(seqFile(700013, 1, 1, seqRecord(100, 200, 0, 2, null, null, sum, det))); // version 0: the summary is not consumed
        inputs.add(seqFile(700013, 1, 1, seqRecord(100, 200, 2, 2, null, null, new byte[0], det)));
        inputs.add(seqFile(700013, 1, 1, seqRecord(100, 200, 1, 2, 500, null, sum, det))); // summary longer than the rest: logged, not taken
        inputs.add(seqFile(700013, 1, 1, seqRecord(100, 200, 1, 2, 0, null, sum, det))); // zero summary length
        inputs.add(seqFile(700013, 1, 1, seqRecord(100, 200, 1, 2, 0xfff0, null, sum, det))); // negative summary length: throws
        inputs.add(seqFile(700013, 1, 1, seqRecord(100, 200, 1, 2, null, 0, sum, new byte[0]))); // no details
        inputs.add(seqFile(700013, 1, 1, seqRecord(100, 200, 1, 2, null, -1, sum, det))); // negative detail length
        inputs.add(seqFile(700013, 1, 1, seqRecord(100, 200, 1, 2, null, 20 * 1025 * 1024 + 1, sum, det))); // beyond GB's cap
        inputs.add(seqFile(700013, 1, 1, seqRecord(100, 200, 1, 2, null, 20 * 1025 * 1024, sum, det))); // at the cap: the read underflows
        inputs.add(seqFile(700013, 1, 1, seqRecord(100, 200, 1, 2, null, 25, sum, det))); // details one byte longer than the rest: underflow
        inputs.add(seqFile(700013, 1, 1, seqRecord(100, 200, 1, 2, null, 24, sum, det), new byte[31])); // trailing bytes shorter than a record
        inputs.add(seqFile(700013, 1, 1, seqRecord(100, 200, 1, 2, null, 24, sum, det), new byte[32])); // trailing zero record
        inputs.add(seqFile(700013, 1, 1, seqRecord(100, 200, 1, 2, null, 24, sum, det), new byte[40]));
        inputs.add(seqFile(700013, 2, 1, seqRecord(100, 200, 1, 2, null, null, sum, det)));
        List<byte[]> fuzz = new ArrayList<>();
        for (int i = 6; i < 7; i++) fuzz.addAll(mutations(inputs.get(i), 6600 + i, 60));
        inputs.addAll(fuzz);
        for (byte[] in : inputs) {
            out.put(GoldenSupport.obj().put("input", hex(in)).put("result", seqFileResult(in)));
        }
        return out;
    }

    // ---- HuaweiTrueSleepSequenceDataParser

    static JSONObject dumpSummary(HuaweiTrueSleepSequenceDataParser.SleepSummary s, boolean onlyChanged) throws Exception {
        JSONObject o = GoldenSupport.obj();
        long defaultBits = Double.doubleToRawLongBits(-1.0);
        for (Field f : HuaweiTrueSleepSequenceDataParser.SleepSummary.class.getFields()) {
            if (f.getType() == double.class) {
                long bits = Double.doubleToRawLongBits(f.getDouble(s));
                if (!onlyChanged || bits != defaultBits) o.put(f.getName(), Long.toHexString(bits));
            } else {
                long v = f.getType() == long.class ? f.getLong(s) : f.getInt(s);
                if (!onlyChanged || v != -1) o.put(f.getName(), v);
            }
        }
        return o;
    }

    static final int[] DICT_IDS = {
        700013686, 700013298, 700013973, 700013156, 700013786, 700013254, 700013679, 700013721, 700013245, 700013713, 700013232, 700013436,
        700013502, 700013340, 700013026, 700013646, 700013492, 700013824, 700013355, 700013305, 700013878, 700013236, 700013225, 700013839,
        700013886, 700013718, 700013227, 700013633, 700013468, 700013810, 700013841, 700013722, 700013580, 700013759, 700013635, 700013670,
        700013821, 700013925, 700013697};

    static HuaweiTLV triplet(int dictId, int dataType, byte[] value) {
        return new HuaweiTLV().put(0x03, dictId).put(0x04, (byte) dataType).put(0x05, value);
    }

    /** A TLV summary: one outer container with one container per value triplet. */
    static byte[] summaryTlv(HuaweiTLV... triplets) {
        HuaweiTLV mid = new HuaweiTLV();
        for (HuaweiTLV t : triplets) mid.put(0x82, t);
        return new HuaweiTLV().put(0x81, mid).serialize();
    }

    static HuaweiSequenceDataFileParser.SequenceFileData fileData(int fileType) {
        HuaweiSequenceDataFileParser.SequenceFileData f = new HuaweiSequenceDataFileParser.SequenceFileData();
        f.setFileType(fileType);
        f.setDictId(700013);
        return f;
    }

    static HuaweiSequenceDataFileParser.SequenceData seqData(int version, int summaryType, byte[] summary, byte[] details) {
        HuaweiSequenceDataFileParser.SequenceData d = new HuaweiSequenceDataFileParser.SequenceData();
        d.setDataVersion(version);
        d.setSummaryType(summaryType);
        d.setSummary(summary);
        d.setDetails(details);
        d.setStartTime(1);
        d.setEndTime(2);
        return d;
    }

    /** `onlyChanged` is the compact form used by the dictionary id sweep: only the raw (uncorrected) fields that differ from the default. */
    static JSONObject summaryResult(int fileType, int version, int summaryType, byte[] summary, boolean onlyChanged) throws Exception {
        JSONObject o = GoldenSupport.obj();
        try {
            HuaweiTrueSleepSequenceDataParser.SleepSummary s = new HuaweiTrueSleepSequenceDataParser().parseData(fileData(fileType), seqData(version, summaryType, summary, null));
            if (s == null) return o.put("null", true);
            o.put("raw", dumpSummary(s, onlyChanged));
            if (onlyChanged) return o;
            o.put("toString", s.toString());
            HuaweiTrueSleepSequenceDataParser.correctSummary(s);
            o.put("corrected", dumpSummary(s, onlyChanged));
        } catch (Exception e) {
            o.put("error", e.getClass().getSimpleName());
        }
        return o;
    }

    static byte[][] valuePool() {
        return new byte[][] {
            new byte[0], new byte[] {0}, new byte[] {5}, new byte[] {(byte) 0x80}, new byte[] {(byte) 0xff}, new byte[] {0, 1}, new byte[] {(byte) 0xff, (byte) 0xff},
            new byte[] {(byte) 0x80, 0}, new byte[] {1, 2, 3}, be(0, 4), be(85, 4), be(100, 4), be(255, 4), be(0x7fffffffL, 4), be(0x80000000L, 4),
            be(0xffffffffL, 4), new byte[] {(byte) 0xbf, (byte) 0x80, 0, 0}, be(1700000130L, 8), be(-1L, 8), be(1L << 40, 8), be(1700000130L, 5),
            be(Double.doubleToRawLongBits(97.5), 8), be(Double.doubleToRawLongBits(-1.0), 8), be(Double.doubleToRawLongBits(1e30), 8),
            be(Double.doubleToRawLongBits(Double.NaN), 8), be(Double.doubleToRawLongBits(Double.POSITIVE_INFINITY), 8), be(Double.doubleToRawLongBits(70.25), 8),
            be(1, 9), be(1700000130L, 8), new byte[] {0, 0, 0, 0, 0, 0, 0, 30}, be(Double.doubleToRawLongBits(3.0), 8),
        };
    }

    static JSONArray summaries() throws Exception {
        JSONArray out = GoldenSupport.arr();
        byte[][] pool = valuePool();
        int[] types = {1, 2, 3, 4, 5, 6, 7, 0};
        Random r = new Random(6700);
        // every dictionary id, every data type, a spread of values; the summary holds one triplet
        for (int dictId : DICT_IDS) {
            for (int t : types) {
                for (int k = 0; k < 2; k++) {
                    byte[] v = pool[r.nextInt(pool.length)];
                    byte[] summary = summaryTlv(triplet(dictId, t, v));
                    out.put(GoldenSupport.arr().put(dictId).put(t).put(hex(v)).put(summaryResult(1, 1, 2, summary, true)));
                }
            }
        }
        // each dictionary id with every pool value as int (type 1), long (3) and double (6), so every branch has hit its limits
        for (int dictId : DICT_IDS) {
            for (byte[] v : pool) {
                for (int t : new int[] {1, 3, 6}) {
                    byte[] summary = summaryTlv(triplet(dictId, t, v));
                    out.put(GoldenSupport.arr().put(dictId).put(t).put(hex(v)).put(summaryResult(1, 1, 2, summary, true)));
                }
            }
        }
        return out;
    }

    static JSONArray summaryShapes() throws Exception {
        JSONArray out = GoldenSupport.arr();
        byte[] ok = summaryTlv(triplet(700013686, 3, be(1700000130L, 8)), triplet(700013786, 1, be(1, 4)), triplet(700013245, 1, be(85, 4)));
        // (name, fileType, version, summaryType, summary)
        Object[][] cases = {
            {"typical", 1, 1, 2, ok},
            {"unknown dict id is ignored", 1, 1, 2, summaryTlv(triplet(12345, 1, be(7, 4)), triplet(700013786, 1, be(1, 4)))},
            {"later triplet wins", 1, 1, 2, summaryTlv(triplet(700013245, 1, be(10, 4)), triplet(700013245, 1, be(20, 4)))},
            {"later invalid triplet keeps the earlier value", 1, 1, 2, summaryTlv(triplet(700013245, 1, be(10, 4)), triplet(700013245, 1, be(-5, 4)))},
            {"triplet without data type is skipped", 1, 1, 2, summaryTlv(new HuaweiTLV().put(0x03, 700013245).put(0x05, be(10, 4)), triplet(700013786, 1, be(1, 4)))},
            {"triplet without value is skipped", 1, 1, 2, summaryTlv(new HuaweiTLV().put(0x03, 700013245).put(0x04, (byte) 1), triplet(700013786, 1, be(1, 4)))},
            {"triplet without dict id is skipped", 1, 1, 2, summaryTlv(new HuaweiTLV().put(0x04, (byte) 1).put(0x05, be(1, 4)), triplet(700013786, 1, be(1, 4)))},
            {"dict id as one byte", 1, 1, 2, summaryTlv(new HuaweiTLV().put(0x03, (byte) 7).put(0x04, (byte) 1).put(0x05, be(1, 4)))},
            {"dict id as two bytes", 1, 1, 2, summaryTlv(new HuaweiTLV().put(0x03, (short) 7).put(0x04, (short) 1).put(0x05, be(1, 4)))},
            {"data type as int", 1, 1, 2, summaryTlv(new HuaweiTLV().put(0x03, 700013245).put(0x04, 1).put(0x05, be(33, 4)))},
            {"empty summary", 1, 1, 2, new byte[0]},
            {"null summary", 1, 1, 2, null},
            {"leaf elements outside containers are ignored", 1, 1, 2, new HuaweiTLV().put(0x03, 700013245).put(0x04, (byte) 1).put(0x05, be(1, 4)).serialize()},
            {"container of non-container elements", 1, 1, 2, new HuaweiTLV().put(0x81, new HuaweiTLV().put(0x03, 700013245).put(0x04, (byte) 1).put(0x05, be(1, 4))).serialize()},
            {"two outer containers", 1, 1, 2, cat(summaryTlv(triplet(700013245, 1, be(10, 4))), summaryTlv(triplet(700013786, 1, be(1, 4))))},
            {"malformed summary (size beyond the end)", 1, 1, 2, new byte[] {(byte) 0x81, 0x50, 1, 2}},
            {"malformed inner container", 1, 1, 2, new HuaweiTLV().put(0x81, new byte[] {(byte) 0x82, 0x40, 1}).serialize()},
            {"file type 2 is not parsed", 2, 1, 2, ok},
            {"data version 2 is not parsed", 1, 2, 2, ok},
            {"data version 0 is not parsed", 1, 0, 2, ok},
            {"summary type 1 is not parsed", 1, 1, 1, ok},
            {"summary type 3 is not parsed", 1, 1, 3, ok},
            {"no valid data: correctSummary blanks", 1, 1, 2, summaryTlv(triplet(700013298, 3, be(1700000000L, 8)), triplet(700013973, 3, be(1700030000L, 8)), triplet(700013245, 1, be(85, 4)),
                    triplet(700013232, 1, be(90, 4)), triplet(700013254, 1, be(3, 4)), triplet(700013679, 1, be(2, 4)), triplet(700013721, 1, be(2, 4)), triplet(700013713, 1, be(2, 4)),
                    triplet(700013821, 3, be(600, 8)), triplet(700013686, 3, be(1700000100L, 8)))},
            {"valid data keeps the values", 1, 1, 2, summaryTlv(triplet(700013786, 1, be(1, 4)), triplet(700013298, 3, be(1700000000L, 8)), triplet(700013973, 3, be(1700030000L, 8)), triplet(700013245, 1, be(85, 4)),
                    triplet(700013232, 1, be(90, 4)), triplet(700013254, 1, be(3, 4)), triplet(700013679, 1, be(2, 4)), triplet(700013821, 3, be(600, 8)), triplet(700013686, 3, be(1700000100L, 8)))},
            {"float -1 validData", 1, 1, 2, summaryTlv(triplet(700013786, 1, new byte[] {(byte) 0xbf, (byte) 0x80, 0, 0}), triplet(700013245, 1, be(85, 4)))},
            {"oxygen as double", 1, 1, 2, summaryTlv(triplet(700013340, 6, be(Double.doubleToRawLongBits(88.0), 8)), triplet(700013026, 6, be(Double.doubleToRawLongBits(99.0), 8)))},
            {"oxygen as int", 1, 1, 2, summaryTlv(triplet(700013340, 1, be(88, 4)), triplet(700013026, 4, be(99, 2)))},
            {"oxygen as long", 1, 1, 2, summaryTlv(triplet(700013340, 3, be(88, 8)), triplet(700013026, 3, be(99, 8)))},
        };
        for (Object[] c : cases) {
            byte[] summary = (byte[]) c[4];
            JSONObject o = GoldenSupport.obj().put("name", c[0]).put("fileType", c[1]).put("version", c[2]).put("summaryType", c[3])
                    .put("summary", summary == null ? JSONObject.NULL : hex(summary));
            o.put("result", summaryResult((Integer) c[1], (Integer) c[2], (Integer) c[3], summary, false));
            out.put(o);
        }
        return out;
    }

    static JSONArray getTimes() {
        JSONArray out = GoldenSupport.arr();
        long[] times = {-1, 0, 1, 59, 60, 61, 119, 1700000100L, 1700000130L, 1700000159L, -61, Long.MAX_VALUE, 1L << 40};
        for (long fall : times) {
            for (long bed : times) {
                for (int valid : new int[] {-1, 0, 1, Integer.MAX_VALUE}) {
                    for (boolean supports : new boolean[] {false, true}) {
                        out.put(GoldenSupport.obj().put("fall", fall).put("bed", bed).put("valid", valid).put("supportsBedTime", supports)
                                .put("result", HuaweiTrueSleepSequenceDataParser.getTime(fall, bed, valid, supports)));
                    }
                }
            }
        }
        return out;
    }

    static byte[] detail(long duration, int status, int... extra) {
        byte[] e = new byte[3];
        for (int i = 0; i < extra.length && i < 3; i++) e[i] = (byte) extra[i];
        return cat(le(duration, 4), new byte[] {(byte) status}, e);
    }

    /** Stages as [stage, minutes] runs; the times of Java's per-minute list are contiguous from the start (checked where it matters). */
    static JSONArray rle(List<HuaweiTrueSleepSequenceDataParser.SleepStage> st) {
        JSONArray out = GoldenSupport.arr();
        int i = 0;
        while (i < st.size()) {
            int j = i;
            while (j < st.size() && st.get(j).getStage() == st.get(i).getStage()) j++;
            out.put(GoldenSupport.arr().put(st.get(i).getStage()).put(j - i));
            i = j;
        }
        return out;
    }

    static JSONArray sleepDetails() {
        JSONArray out = GoldenSupport.arr();
        List<byte[]> inputs = new ArrayList<>();
        inputs.add(new byte[0]);
        inputs.add(detail(120, 1));
        inputs.add(cat(detail(120, 1), detail(0, 1), detail(60, 3), detail(60, 3), detail(90, 2), detail(180, 4), detail(60, 9)));
        inputs.add(cat(detail(60, 0), detail(60, 1)));
        inputs.add(cat(detail(-60, 1), detail(60, 2)));
        inputs.add(cat(detail(-120, 1), detail(60, 2)));
        inputs.add(cat(detail(0x80000000L, 1), detail(60, 2)));
        inputs.add(cat(detail(1440 * 60, 3), detail(60, 2)));
        inputs.add(cat(detail(1441 * 60, 3), detail(60, 2)));
        inputs.add(cat(detail(60, -1), detail(60, 127), detail(60, -128), detail(60, 5)));
        inputs.add(cat(detail(60, 1, 9, 8, 7), detail(60, 1, 0xff, 0xff, 0xff)));
        inputs.add(new byte[4]);
        inputs.add(new byte[8]);
        inputs.add(new byte[12]);
        inputs.add(new byte[16]);
        inputs.add(new byte[20]);
        inputs.add(new byte[5]);
        inputs.add(new byte[7]);
        inputs.add(new byte[9]);
        inputs.add(cat(detail(120, 1), new byte[4]));
        inputs.add(cat(detail(120, 1), new byte[4], detail(60, 2)));
        inputs.add(cat(detail(120, 1), le(60, 4)));
        inputs.add(cat(detail(120, 1), le(60, 4), new byte[]{1}));
        inputs.add(cat(detail(120, 1), le(60, 4), new byte[]{1, 2, 3}));
        Random r = new Random(6800);
        for (int i = 0; i < 80; i++) {
            int n = r.nextInt(7);
            byte[] all = new byte[0];
            for (int k = 0; k < n; k++) {
                long d;
                switch (r.nextInt(6)) {
                    case 0: d = 60L * r.nextInt(40); break;
                    case 1: d = r.nextInt(300); break;
                    case 2: d = -60L * r.nextInt(5); break;
                    case 3: d = 60L * (1435 + r.nextInt(12)); break;
                    default: d = 60L * (1 + r.nextInt(8));
                }
                all = cat(all, detail(d, r.nextInt(8) - 1, r.nextInt(256), r.nextInt(256), r.nextInt(256)));
            }
            if (r.nextInt(6) == 0) all = java.util.Arrays.copyOf(all, Math.max(0, all.length - 1 - r.nextInt(7)));
            inputs.add(all);
        }
        long[] starts = {1700000100L, 0, -60, 1700000130L};
        int idx = 0;
        for (byte[] in : inputs) {
            long start = starts[idx++ % starts.length];
            JSONObject o = GoldenSupport.obj().put("input", hex(in)).put("time", start);
            try {
                List<HuaweiTrueSleepSequenceDataParser.SleepStage> st = HuaweiTrueSleepSequenceDataParser.parseSleepDetails(in, start);
                if (st == null) {
                    o.put("result", GoldenSupport.obj().put("null", true));
                } else {
                    JSONArray stages = rle(st);
                    boolean contiguous = true;
                    for (int i = 0; i < st.size(); i++) {
                        if (st.get(i).getTime() != start + 60L * i) contiguous = false;
                    }
                    o.put("result", GoldenSupport.obj().put("stages", stages).put("contiguous", contiguous));
                }
            } catch (Exception e) {
                o.put("result", error(e));
            }
            out.put(o);
        }
        return out;
    }

    // ---- what SleepSync.parseSequenceFile consumes: per record the corrected summary, the start time and the stages

    static JSONObject pipeline(byte[] file, boolean supportsBedTime) {
        JSONObject o = GoldenSupport.obj();
        try {
            HuaweiSequenceDataFileParser.SequenceFileData f = HuaweiSequenceDataFileParser.parseSequenceFileData(file);
            if (f == null) return o.put("file", JSONObject.NULL);
            JSONArray recs = GoldenSupport.arr();
            for (HuaweiSequenceDataFileParser.SequenceData sd : f.getSequenceDataList()) {
                JSONObject r = GoldenSupport.obj();
                HuaweiTrueSleepSequenceDataParser.SleepSummary summary = new HuaweiTrueSleepSequenceDataParser().parseData(f, sd);
                if (summary == null) {
                    r.put("summary", JSONObject.NULL);
                    recs.put(r);
                    continue;
                }
                HuaweiTrueSleepSequenceDataParser.correctSummary(summary);
                r.put("sleepScore", summary.sleepScore).put("sleepEfficiency", summary.sleepEfficiency).put("wakeupTime", summary.wakeupTime);
                long time = HuaweiTrueSleepSequenceDataParser.getTime(summary.fallAsleepTime, summary.bedTime, summary.validData, supportsBedTime);
                r.put("time", time);
                byte[] details = sd.getDetails();
                if (details == null) {
                    r.put("details", JSONObject.NULL);
                } else {
                    List<HuaweiTrueSleepSequenceDataParser.SleepStage> st = HuaweiTrueSleepSequenceDataParser.parseSleepDetails(details, time);
                    if (st == null) {
                        r.put("stages", JSONObject.NULL);
                    } else {
                        JSONArray stages = rle(st);
                        r.put("stages", stages);
                        r.put("stagesFrom", time);
                    }
                }
                recs.put(r);
            }
            o.put("records", recs);
        } catch (Exception e) {
            o.put("error", e.getClass().getSimpleName());
        }
        return o;
    }

    static byte[] sleepSummary(long fall, long bed, long rising, long wake, Integer valid, Integer score, Integer efficiency) {
        List<HuaweiTLV> t = new ArrayList<>();
        if (fall >= 0) t.add(triplet(700013686, 3, be(fall, 8)));
        if (bed >= 0) t.add(triplet(700013298, 3, be(bed, 8)));
        if (rising >= 0) t.add(triplet(700013973, 3, be(rising, 8)));
        if (wake >= 0) t.add(triplet(700013156, 3, be(wake, 8)));
        if (valid != null) t.add(triplet(700013786, 1, be(valid, 4)));
        if (score != null) t.add(triplet(700013245, 1, be(score, 4)));
        if (efficiency != null) t.add(triplet(700013232, 1, be(efficiency, 4)));
        return summaryTlv(t.toArray(new HuaweiTLV[0]));
    }

    static byte[] stagesDetails(int... durationMinutesAndStage) {
        byte[] d = new byte[0];
        for (int i = 0; i < durationMinutesAndStage.length; i += 2) d = cat(d, detail(durationMinutesAndStage[i] * 60L, durationMinutesAndStage[i + 1], 0, 0, 0));
        return d;
    }

    static JSONArray pipelines() {
        JSONArray out = GoldenSupport.arr();
        List<Object[]> cases = new ArrayList<>();
        byte[] night1 = stagesDetails(30, 1, 45, 3, 20, 2, 5, 4, 40, 1, 10, 5, 3, 9, 7, 0, 12, 1);
        byte[] night2 = stagesDetails(120, 3, 60, 1);
        cases.add(new Object[] {"one night", seqFile(700013, 1, 1, seqRecord(1700000000, 1700030000, 1, 2, null, null,
                sleepSummary(1700000130L, 1699999000L, 1700030000L, 1700029900L, 1, 85, 91), night1))});
        cases.add(new Object[] {"two nights", seqFile(700013, 1, 1,
                seqRecord(1700000000, 1700030000, 1, 2, null, null, sleepSummary(1700000130L, 1699999000L, 1700030000L, 1700029900L, 1, 85, 91), night1),
                seqRecord(1700086400, 1700100000, 1, 2, null, null, sleepSummary(1700086460L, 1700086000L, 1700100000L, 1700099000L, 1, 70, 120), night2))});
        cases.add(new Object[] {"score out of range, efficiency out of range", seqFile(700013, 1, 1,
                seqRecord(1700000000, 1700030000, 1, 2, null, null, sleepSummary(1700000130L, 1699999000L, 1700030000L, 1700029900L, 1, 101, 101), night2))});
        cases.add(new Object[] {"score 0 and 100", seqFile(700013, 1, 1,
                seqRecord(1700000000, 1700030000, 1, 2, null, null, sleepSummary(1700000130L, 1699999000L, 1700030000L, 1700029900L, 1, 0, 100), night2),
                seqRecord(1700086400, 1700100000, 1, 2, null, null, sleepSummary(1700086460L, 1700086000L, 1700100000L, 1700099000L, 1, 100, 0), night2))});
        cases.add(new Object[] {"no valid data blanks the score", seqFile(700013, 1, 1,
                seqRecord(1700000000, 1700030000, 1, 2, null, null, sleepSummary(1700000130L, 1699999000L, 1700030000L, 1700029900L, null, 85, 91), night2))});
        cases.add(new Object[] {"no wake-up time", seqFile(700013, 1, 1,
                seqRecord(1700000000, 1700030000, 1, 2, null, null, sleepSummary(1700000130L, 1699999000L, 1700030000L, -1, 1, 85, 91), night2))});
        cases.add(new Object[] {"wake-up time before the start", seqFile(700013, 1, 1,
                seqRecord(1700000000, 1700030000, 1, 2, null, null, sleepSummary(1700000130L, 1699999000L, 1700030000L, 1699990000L, 1, 85, 91), night2))});
        cases.add(new Object[] {"no score", seqFile(700013, 1, 1,
                seqRecord(1700000000, 1700030000, 1, 2, null, null, sleepSummary(1700000130L, 1699999000L, 1700030000L, 1700029900L, 1, null, null), night2))});
        cases.add(new Object[] {"record without details", seqFile(700013, 1, 1,
                seqRecord(1700000000, 1700030000, 1, 2, null, 0, sleepSummary(1700000130L, 1699999000L, 1700030000L, 1700029900L, 1, 85, 91), new byte[0]))});
        cases.add(new Object[] {"details of a bad length", seqFile(700013, 1, 1,
                seqRecord(1700000000, 1700030000, 1, 2, null, null, sleepSummary(1700000130L, 1699999000L, 1700030000L, 1700029900L, 1, 85, 91), new byte[10]))});
        cases.add(new Object[] {"details with a truncated record", seqFile(700013, 1, 1,
                seqRecord(1700000000, 1700030000, 1, 2, null, null, sleepSummary(1700000130L, 1699999000L, 1700030000L, 1700029900L, 1, 85, 91), new byte[12]))});
        cases.add(new Object[] {"unparsed summary (version 2)", seqFile(700013, 1, 1,
                seqRecord(1700000000, 1700030000, 2, 2, null, null, new byte[0], night2))});
        cases.add(new Object[] {"unparsed summary (file type 2)", seqFile(700013, 2, 1,
                seqRecord(1700000000, 1700030000, 1, 2, null, null, sleepSummary(1700000130L, 1699999000L, 1700030000L, 1700029900L, 1, 85, 91), night2))});
        cases.add(new Object[] {"stage with no valid records", seqFile(700013, 1, 1,
                seqRecord(1700000000, 1700030000, 1, 2, null, null, sleepSummary(1700000130L, 1699999000L, 1700030000L, 1700029900L, 1, 85, 91), stagesDetails(0, 1, 7, 0)))});
        cases.add(new Object[] {"one good, one skipped, one good", seqFile(700013, 1, 1,
                seqRecord(1700000000, 1700030000, 1, 2, null, null, sleepSummary(1700000130L, 1699999000L, 1700030000L, 1700029900L, 1, 85, 91), night2),
                seqRecord(1700040000, 1700050000, 2, 2, null, null, new byte[0], night2),
                seqRecord(1700086400, 1700100000, 1, 2, null, null, sleepSummary(1700086460L, 1700086000L, 1700100000L, 1700099000L, 1, 60, 80), night1))});
        cases.add(new Object[] {"short file", new byte[10]});
        cases.add(new Object[] {"negative summary length", seqFile(700013, 1, 1, seqRecord(1700000000, 1700030000, 1, 2, 0xfff0, null, sleepSummary(1700000130L, 1699999000L, 1700030000L, 1700029900L, 1, 85, 91), night2))});
        for (Object[] c : cases) {
            byte[] file = (byte[]) c[1];
            out.put(GoldenSupport.obj().put("name", c[0]).put("file", hex(file))
                    .put("withBedTime", pipeline(file, true)).put("withoutBedTime", pipeline(file, false)));
        }
        return out;
    }

    public static void main(String[] args) throws Exception {
        JSONObject root = GoldenSupport.obj();
        root.put("dictSleepDetailsClass", HuaweiDictTypes.SLEEP_DETAILS_CLASS);
        root.put("dictSkinTemperatureClass", HuaweiDictTypes.SKIN_TEMPERATURE_CLASS);
        root.put("dictSkinTemperatureValue", HuaweiDictTypes.SKIN_TEMPERATURE_VALUE);
        root.put("dictArrhythmiaClass", HuaweiDictTypes.ARRHYTHMIA_CLASS);
        root.put("state", truSleepState());
        root.put("data", truSleepData());
        root.put("sequenceFiles", sequenceFiles());
        root.put("summaryShapes", summaryShapes());
        root.put("getTime", getTimes());
        root.put("sleepDetails", sleepDetails());
        root.put("pipelines", pipelines());
        GoldenSupport.write(args[0], "sleep_parsers.json", root);

        // the per-dictionary-id sweep is large: compact JSON in its own file
        JSONObject sweep = GoldenSupport.obj();
        sweep.put("summaries", summaries());
        Files.writeString(Path.of(args[0], "sleep_summaries.json"), sweep.toString() + "\n", StandardCharsets.UTF_8);
        System.out.println("wrote " + Path.of(args[0], "sleep_summaries.json"));
    }
}

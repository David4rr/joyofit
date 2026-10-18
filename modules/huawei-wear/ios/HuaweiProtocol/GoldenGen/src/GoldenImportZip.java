import java.io.ByteArrayInputStream;
import java.io.File;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Arrays;
import java.util.Base64;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Random;

import net.lingala.zip4j.ZipFile;
import net.lingala.zip4j.model.FileHeader;
import net.lingala.zip4j.model.ZipParameters;
import net.lingala.zip4j.model.enums.AesKeyStrength;
import net.lingala.zip4j.model.enums.AesVersion;
import net.lingala.zip4j.model.enums.CompressionMethod;
import net.lingala.zip4j.model.enums.EncryptionMethod;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * The export ZIPs of the Huawei import, written by zip4j (the library the Android import reads them with): AES-128/256 (AE-1 and AE-2; zip4j cannot write 192),
 * the traditional cipher, stored and deflated members, with a password that is not ASCII. The contents are reproducible; the AES salt is random,
 * so regenerating changes the archive bytes but not what is in them. Each archive is read back with zip4j before it is written.
 */
public final class GoldenImportZip {
    static byte[] content(long seed, int textBytes, int randomBytes) {
        Random r = new Random(seed);
        String[] words = {"heart", "rate", "sleep", "steps", "DATA_POINT", "samplePoints", "startTime", "1750000020000", "\"key\"", "value", "{", "}", ",", "tp=lbs;k=1;"};
        StringBuilder sb = new StringBuilder();
        while (sb.length() < textBytes) sb.append(words[r.nextInt(words.length)]).append(' ');
        byte[] text = sb.substring(0, textBytes).getBytes(StandardCharsets.UTF_8);
        byte[] random = new byte[randomBytes];
        r.nextBytes(random);
        byte[] all = Arrays.copyOf(text, text.length + random.length);
        System.arraycopy(random, 0, all, text.length, random.length);
        return all;
    }

    static String b64(byte[] b) { return Base64.getEncoder().encodeToString(b); }

    public static void main(String[] args) throws Exception {
        Map<String, byte[]> files = new LinkedHashMap<>();
        files.put("Health detail data & description/Health detail data1.json", content(1, 30_000, 0));
        files.put("Sport per minute merged data & description/Sport per minute1.json", content(2, 3_000, 0));
        files.put("Motion path detail data & description/mixed.json", content(3, 12_000, 3_000));
        files.put("empty.json", new byte[0]);

        JSONObject root = new JSONObject();
        JSONObject fileJson = new JSONObject();
        for (Map.Entry<String, byte[]> e : files.entrySet()) fileJson.put(e.getKey(), b64(e.getValue()));
        root.put("files", fileJson);

        JSONArray cases = new JSONArray();
        Object[][] specs = {
            // name, password, method (NONE, AES, ZIP_STANDARD), strength bits, aes version, compression
            {"plainDeflate", null, EncryptionMethod.NONE, 0, 2, CompressionMethod.DEFLATE},
            {"plainStored", null, EncryptionMethod.NONE, 0, 2, CompressionMethod.STORE},
            {"aes256", "s3cret-Pass", EncryptionMethod.AES, 256, 2, CompressionMethod.DEFLATE},
            {"aes256Ae1", "s3cret-Pass", EncryptionMethod.AES, 256, 1, CompressionMethod.DEFLATE},
            {"aes256Unicode", "k\u00e4se-Pa\u00dfwort\u2713", EncryptionMethod.AES, 256, 2, CompressionMethod.DEFLATE},
            {"aes128", "p\u00e4ssw\u00f6rd", EncryptionMethod.AES, 128, 2, CompressionMethod.DEFLATE},
            {"aes256Stored", "s3cret-Pass", EncryptionMethod.AES, 256, 2, CompressionMethod.STORE},
            {"zipCrypto", "classic", EncryptionMethod.ZIP_STANDARD, 0, 2, CompressionMethod.DEFLATE},
            {"zipCryptoStored", "classic", EncryptionMethod.ZIP_STANDARD, 0, 2, CompressionMethod.STORE},
        };
        for (Object[] spec : specs) {
            String name = (String) spec[0];
            String password = (String) spec[1];
            EncryptionMethod method = (EncryptionMethod) spec[2];
            File file = File.createTempFile("import-golden-" + name, ".zip");
            file.delete();
            ZipFile zip = password == null ? new ZipFile(file) : new ZipFile(file, password.toCharArray());
            for (Map.Entry<String, byte[]> e : files.entrySet()) {
                ZipParameters p = new ZipParameters();
                p.setFileNameInZip(e.getKey());
                p.setCompressionMethod((CompressionMethod) spec[5]);
                if (method != EncryptionMethod.NONE) {
                    p.setEncryptFiles(true);
                    p.setEncryptionMethod(method);
                    if (method == EncryptionMethod.AES) {
                        int bits = (Integer) spec[3];
                        p.setAesKeyStrength(bits == 128 ? AesKeyStrength.KEY_STRENGTH_128 : AesKeyStrength.KEY_STRENGTH_256);
                        p.setAesVersion((Integer) spec[4] == 1 ? AesVersion.ONE : AesVersion.TWO);
                    }
                }
                zip.addStream(new ByteArrayInputStream(e.getValue()), p);
            }
            zip.close();

            // Read it back the way the Android import does.
            ZipFile check = password == null ? new ZipFile(file) : new ZipFile(file, password.toCharArray());
            for (FileHeader h : check.getFileHeaders()) {
                try (InputStream in = check.getInputStream(h)) {
                    byte[] got = in.readAllBytes();
                    if (!Arrays.equals(got, files.get(h.getFileName()))) throw new IllegalStateException(name + ": " + h.getFileName() + " differs after reading back");
                }
            }
            check.close();

            JSONObject c = new JSONObject();
            c.put("name", name);
            c.put("password", password == null ? JSONObject.NULL : password);
            c.put("zip", b64(Files.readAllBytes(file.toPath())));
            cases.put(c);
            file.delete();
        }
        root.put("cases", cases);
        GoldenSupport.write(args[0], "importZip.json", root);
    }
}

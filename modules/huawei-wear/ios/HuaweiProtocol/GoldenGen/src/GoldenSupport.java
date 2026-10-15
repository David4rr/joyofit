import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Random;

import org.json.JSONArray;
import org.json.JSONObject;

/** Helpers shared by the Golden*.java generators: hex, seeded bytes, JSON output. Fixtures are written under the directory given as args[0]. */
final class GoldenSupport {
    private GoldenSupport() {}

    static String hex(byte[] b) {
        if (b == null) return null;
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format("%02x", x & 0xFF));
        return sb.toString();
    }

    static byte[] unhex(String s) {
        byte[] out = new byte[s.length() / 2];
        for (int i = 0; i < out.length; i++) out[i] = (byte) Integer.parseInt(s.substring(i * 2, i * 2 + 2), 16);
        return out;
    }

    /** Reproducible pseudo-random bytes: the same seed gives the same input in every regeneration. */
    static byte[] bytes(long seed, int length) {
        byte[] b = new byte[length];
        new Random(seed).nextBytes(b);
        return b;
    }

    static void write(String dir, String name, JSONObject root) throws IOException {
        Path path = Path.of(dir, name);
        Files.createDirectories(path.getParent());
        Files.writeString(path, root.toString(1) + "\n", StandardCharsets.UTF_8);
        System.out.println("wrote " + path);
    }

    static JSONArray arr() { return new JSONArray(); }
    static JSONObject obj() { return new JSONObject(); }
}

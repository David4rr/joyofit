import java.math.BigDecimal;
import java.math.RoundingMode;
import java.net.URLEncoder;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;

import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiPacket;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.HuaweiTLV;
import nodomain.freeyourgadget.gadgetbridge.devices.huawei.packets.Weather;

import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Weather (service 0x0f): every request the phone sends and every answer it reads, built and parsed by the real Gadgetbridge
 * {@code Weather} class, plus the Java number formatting the Kotlin weather code relies on (String.format("%.2f"), BigDecimal rounding,
 * URLEncoder) and the moon phase formula of Moon.kt, so the Swift port can be compared byte for byte.
 */
public class GoldenWeather {
    static byte[] b(int... v) {
        byte[] out = new byte[v.length];
        for (int i = 0; i < v.length; i++) out[i] = (byte) v[i];
        return out;
    }

    // MARK: Settings

    static final String[] FLAGS = {"weather", "wind", "pm25", "temp", "loc", "curTemp", "unit", "aqi", "time", "source", "icon", "extHourly", "sunrise", "moon", "uv"};

    static Weather.Settings settings(String flags) {
        Weather.Settings s = new Weather.Settings();
        for (String f : flags.split(",")) {
            switch (f.trim()) {
                case "": break;
                case "weather": s.weatherSupported = true; break;
                case "wind": s.windSupported = true; break;
                case "pm25": s.pm25Supported = true; break;
                case "temp": s.temperatureSupported = true; break;
                case "loc": s.locationNameSupported = true; break;
                case "curTemp": s.currentTemperatureSupported = true; break;
                case "unit": s.unitSupported = true; break;
                case "aqi": s.airQualityIndexSupported = true; break;
                case "time": s.timeSupported = true; break;
                case "source": s.sourceSupported = true; break;
                case "icon": s.weatherIconSupported = true; break;
                case "extHourly": s.extendedHourlyForecast = true; break;
                case "sunrise": s.sunRiseSetSupported = true; break;
                case "moon": s.moonPhaseSupported = true; break;
                case "uv": s.uvIndexSupported = true; break;
                default: throw new IllegalArgumentException(f);
            }
        }
        return s;
    }

    static final String ALL = String.join(",", FLAGS);

    // MARK: current weather

    static Object nul(Object v) {
        return v == null ? JSONObject.NULL : v;
    }

    static Byte by(Integer v) {
        return v == null ? null : (byte) (int) v;
    }

    static Short sh(Integer v) {
        return v == null ? null : (short) (int) v;
    }

    static JSONObject current(String name, String flags, Weather.WeatherIcon icon, Integer windDirection, Integer windSpeed, Integer low, Integer high,
                              Integer pm25, String location, Integer cur, Weather.HuaweiTemperatureFormat unit, Integer aqi, Integer obs,
                              Float uv, String source, Integer humidity, Integer windValue, Integer feel) throws Exception {
        HuaweiPacket p = new Weather.CurrentWeatherRequest(PacketsGoldenKit.params(), settings(flags), icon, windDirection, by(windSpeed), by(low), by(high),
            sh(pm25), location, by(cur), unit, sh(aqi), obs, uv, source, by(humidity), windValue, feel);
        JSONObject o = PacketsGoldenKit.request(name, p);
        o.put("settings", flags);
        o.put("icon", nul(icon == null ? null : icon.name()));
        o.put("windDirection", nul(windDirection));
        o.put("windSpeed", nul(windSpeed));
        o.put("low", nul(low));
        o.put("high", nul(high));
        o.put("pm25", nul(pm25));
        o.put("location", nul(location));
        o.put("cur", nul(cur));
        o.put("unit", nul(unit == null ? null : unit.name()));
        o.put("aqi", nul(aqi));
        o.put("obs", nul(obs));
        o.put("uv", nul(uv == null ? null : (double) uv));
        o.put("source", nul(source));
        o.put("humidity", nul(humidity));
        o.put("windValue", nul(windValue));
        o.put("feel", nul(feel));
        return o;
    }

    // MARK: forecast

    static Weather.WeatherForecastData.TimeData hour(int ts, Weather.WeatherIcon icon, Integer temp, Integer precip, Integer uv) {
        Weather.WeatherForecastData.TimeData t = new Weather.WeatherForecastData.TimeData();
        t.timestamp = ts;
        t.icon = icon;
        t.temperature = by(temp);
        t.precipitation = by(precip);
        t.uvIndex = by(uv);
        return t;
    }

    static Weather.WeatherForecastData.DayData day(int ts, Weather.WeatherIcon icon, Integer high, Integer low, Integer sunrise, Integer sunset,
                                                   Integer moonRise, Integer moonSet, Weather.MoonPhase phase) {
        Weather.WeatherForecastData.DayData d = new Weather.WeatherForecastData.DayData();
        d.timestamp = ts;
        d.icon = icon;
        d.highTemperature = by(high);
        d.lowTemperature = by(low);
        d.sunriseTime = sunrise;
        d.sunsetTime = sunset;
        d.moonRiseTime = moonRise;
        d.moonSetTime = moonSet;
        d.moonPhase = phase;
        return d;
    }

    static JSONObject forecast(String name, String flags, List<Weather.WeatherForecastData.TimeData> hours, List<Weather.WeatherForecastData.DayData> days) throws Exception {
        HuaweiPacket p = new Weather.WeatherForecastData.Request(PacketsGoldenKit.params(), settings(flags), hours, days);
        JSONObject o = PacketsGoldenKit.request(name, p);
        o.put("settings", flags);
        if (hours == null) {
            o.put("hours", JSONObject.NULL);
        } else {
            JSONArray ha = GoldenSupport.arr();
            for (Weather.WeatherForecastData.TimeData h : hours) {
                ha.put(GoldenSupport.obj().put("timestamp", h.timestamp).put("icon", nul(h.icon == null ? null : h.icon.name()))
                    .put("temperature", nul(h.temperature == null ? null : (int) h.temperature))
                    .put("precipitation", nul(h.precipitation == null ? null : (int) h.precipitation))
                    .put("uv", nul(h.uvIndex == null ? null : (int) h.uvIndex)));
            }
            o.put("hours", ha);
        }
        if (days == null) {
            o.put("days", JSONObject.NULL);
        } else {
            JSONArray da = GoldenSupport.arr();
            for (Weather.WeatherForecastData.DayData d : days) {
                da.put(GoldenSupport.obj().put("timestamp", d.timestamp).put("icon", nul(d.icon == null ? null : d.icon.name()))
                    .put("high", nul(d.highTemperature == null ? null : (int) d.highTemperature))
                    .put("low", nul(d.lowTemperature == null ? null : (int) d.lowTemperature))
                    .put("sunrise", nul(d.sunriseTime)).put("sunset", nul(d.sunsetTime))
                    .put("moonRise", nul(d.moonRiseTime)).put("moonSet", nul(d.moonSetTime))
                    .put("moonPhase", nul(d.moonPhase == null ? null : d.moonPhase.name())));
            }
            o.put("days", da);
        }
        return o;
    }

    // MARK: GpsAndTime.CurrentGPSRequest (a Kotlin class in HuaweiWeather.kt; same TLV calls on the real HuaweiTLV)

    static class CurrentGps extends HuaweiPacket {
        CurrentGps(HuaweiPacket.ParamsProvider pp, int timestamp, double latitude, double longitude) {
            super(pp);
            this.serviceId = 0x18;
            this.commandId = 0x07;
            this.tlv = new HuaweiTLV().put(0x01, timestamp).put(0x02, latitude).put(0x03, longitude);
            this.isEncrypted = true;
            this.complete = true;
        }
    }

    static final PacketsGoldenKit.Dumper NONE = null;

    static JSONObject response(String name, int command, HuaweiTLV tlv) {
        return PacketsGoldenKit.response(name, 0x0f, command, tlv);
    }

    static JSONObject response(String name, int command, byte[] tlv) {
        return PacketsGoldenKit.response(name, 0x0f, command, tlv);
    }

    // MARK: Moon.kt, verbatim arithmetic

    static int moonPhaseDegrees(long epochSec) {
        double julianDate = epochSec / 86400.0 + 2440587.5;
        double cycles = (julianDate - 2451550.26) / 29.530588853;
        cycles -= Math.floor(cycles);
        return (int) Math.round(cycles * 360.0) % 360;
    }

    public static void main(String[] args) throws Exception {
        JSONObject root = GoldenSupport.obj();
        Weather.WeatherIcon[] icons = Weather.WeatherIcon.values();

        // ---- requests
        JSONArray requests = GoldenSupport.arr();
        Weather.WeatherIcon cloudy = Weather.WeatherIcon.CLOUDY;
        Weather.HuaweiTemperatureFormat c = Weather.HuaweiTemperatureFormat.CELSIUS;
        Weather.HuaweiTemperatureFormat f = Weather.HuaweiTemperatureFormat.FAHRENHEIT;

        requests.put(current("current all supported, fahrenheit", ALL, cloudy, 90, 3, 23, 31, null, "Bandung", 28, f, null, 1760412600, 5.2f, "Open-Meteo", 78, 14, 30));
        requests.put(current("current all supported, celsius", ALL, Weather.WeatherIcon.SUNNY, 0, 0, -5, 5, 12, "Tromsø", -3, c, 40, 1760412600, 0.4f, "Open-Meteo", 100, 0, -9));
        requests.put(current("current nothing supported", "", cloudy, 90, 3, 23, 31, 7, "Bandung", 28, f, 3, 1760412600, 5.2f, "Open-Meteo", 78, 14, 30));
        requests.put(current("current icon only", "icon", Weather.WeatherIcon.HAZY, 90, 3, 23, 31, null, "x", 28, f, null, 1, 5f, "s", 78, 14, 30));
        requests.put(current("current wind only", "wind", cloudy, 135, 12, 23, 31, null, "x", 28, f, null, 1, 5f, "s", 78, 14, 30));
        requests.put(current("current wind, null speed", "wind", cloudy, 270, null, null, null, null, null, null, null, null, null, null, null, null, null, null));
        requests.put(current("current wind, null direction", "wind", cloudy, null, 7, null, null, null, null, null, null, null, null, null, null, null, null, null));
        requests.put(current("current wind, null both", "wind", cloudy, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null));
        requests.put(current("current temperature range needs both", "temp", cloudy, 0, 0, 10, null, null, null, null, null, null, null, null, null, null, null, null));
        requests.put(current("current range with temp", "temp", cloudy, 0, 0, 10, 20, null, null, null, null, null, null, null, null, null, null, null));
        requests.put(current("current current temperature only", "curTemp", cloudy, 0, 0, 10, 20, null, "x", 0xEC, c, null, null, null, null, null, null, null));
        requests.put(current("current unit only", "unit", cloudy, 0, 0, 10, 20, null, "x", 5, f, null, null, null, null, null, null, null));
        requests.put(current("current extended hourly without humidity", "extHourly", cloudy, 0, 0, 10, 20, null, "x", 5, f, null, 5, null, "s", null, 3, null));
        requests.put(current("current extended hourly all", "extHourly", cloudy, 0, 0, 10, 20, null, "x", 5, f, null, 5, null, "s", 55, 33, 22));
        requests.put(current("current uv unsupported", "weather,time", cloudy, 0, 0, 10, 20, null, "x", 5, f, null, 77, 9f, "s", 55, 33, 22));
        requests.put(current("current uv supported only", "uv", cloudy, 0, 0, 10, 20, null, "x", 5, f, null, 77, 9f, "s", 55, 33, 22));
        // Wind directions: the octant table and its out-of-range quirk.
        int[] directions = {-5, -1, 0, 1, 22, 23, 44, 45, 67, 68, 90, 112, 113, 135, 157, 158, 180, 202, 203, 225, 247, 248, 270, 292, 293, 315, 337, 338, 359, 360, 361, 1000};
        for (int d : directions) {
            requests.put(current("wind direction " + d, "wind", cloudy, d, 5, null, null, null, null, null, null, null, null, null, null, null, null, null));
        }
        // Wind speed bytes: a Beaufort scale value, then a byte that sign-extends into the high half.
        for (int speed : new int[]{0, 1, 12, 127, 128, 200, 255}) {
            requests.put(current("wind speed " + speed, "wind", cloudy, 90, speed, null, null, null, null, null, null, null, null, null, null, null, null, null));
        }
        // UV rounding (Math.round(float) cast to byte).
        for (float uv : new float[]{0f, 0.49f, 0.5f, 1.5f, 2.5f, 5.2f, 10.6f, 11.5f, -0.4f, -0.5f, -1.5f, 127.4f, 127.5f, 128.4f, 255.6f, 300f}) {
            requests.put(current("uv " + uv, "uv", cloudy, null, null, null, null, null, null, null, null, null, null, uv, null, null, null, null));
        }
        // Every icon, and a temperature byte sweep.
        for (Weather.WeatherIcon icon : icons) {
            requests.put(current("icon " + icon.name(), "icon", icon, null, null, null, null, null, null, null, null, null, null, null, null, null, null, null));
        }
        requests.put(current("icon null", "icon,wind", null, 90, 3, null, null, null, null, null, null, null, null, null, null, null, null, null));
        requests.put(current("pm25 and aqi", "pm25,aqi", cloudy, null, null, null, null, 300, null, null, null, 0xFFFF, null, null, null, null, null, null));
        requests.put(current("empty and long strings", "loc,source", cloudy, null, null, null, null, null, "", null, null, null, null, null, "Open-Meteo \u00fc\u4e2d", null, null, null));

        requests.put(GoldenSupport.obj().put("name", "support").put("kind", "support")
            .put("packet", PacketsGoldenKit.request("support", new Weather.WeatherSupport.Request(PacketsGoldenKit.params()))));
        requests.put(GoldenSupport.obj().put("name", "extendedSupport").put("kind", "extendedSupport")
            .put("packet", PacketsGoldenKit.request("extendedSupport", new Weather.WeatherExtendedSupport.Request(PacketsGoldenKit.params()))));
        requests.put(GoldenSupport.obj().put("name", "sunMoonSupport").put("kind", "sunMoonSupport")
            .put("packet", PacketsGoldenKit.request("sunMoonSupport", new Weather.WeatherSunMoonSupport.Request(PacketsGoldenKit.params()))));
        requests.put(GoldenSupport.obj().put("name", "start").put("kind", "start")
            .put("packet", PacketsGoldenKit.request("start", new Weather.WeatherStart.Request(PacketsGoldenKit.params()))));
        for (int value : new int[]{0x000186A0, 0, -1, 0x7FFFFFFF}) {
            requests.put(GoldenSupport.obj().put("name", "device request " + value).put("kind", "deviceRequest").put("value", value)
                .put("packet", PacketsGoldenKit.request("device request", new Weather.WeatherDeviceRequest(PacketsGoldenKit.params(), value))));
        }
        for (Weather.HuaweiTemperatureFormat unit : Weather.HuaweiTemperatureFormat.values()) {
            requests.put(GoldenSupport.obj().put("name", "unit " + unit).put("kind", "unit").put("unit", unit.name())
                .put("packet", PacketsGoldenKit.request("unit", new Weather.WeatherUnitRequest(PacketsGoldenKit.params(), unit))));
        }
        for (Weather.ErrorCode code : Weather.ErrorCode.values()) {
            requests.put(GoldenSupport.obj().put("name", "error simple " + code).put("kind", "errorSimple").put("code", code.name())
                .put("packet", PacketsGoldenKit.request("error simple", new Weather.WeatherErrorSimple.Request(PacketsGoldenKit.params(), code))));
            for (boolean server : new boolean[]{false, true}) {
                requests.put(GoldenSupport.obj().put("name", "error extended " + code + " server=" + server).put("kind", "errorExtended")
                    .put("code", code.name()).put("serverError", server)
                    .put("packet", PacketsGoldenKit.request("error extended", new Weather.WeatherErrorExtended.Request(PacketsGoldenKit.params(), code, server))));
            }
        }
        // GpsAndTime 0x18/0x07
        double[][] points = {{-6.9147445, 107.6098112}, {0, 0}, {-90, 180}, {51.5072, -0.1276}, {1e-7, -1e-7}};
        for (double[] pt : points) {
            requests.put(GoldenSupport.obj().put("name", "gps " + pt[0] + "," + pt[1]).put("kind", "gps").put("timestamp", 1760326200)
                .put("latitude", pt[0]).put("longitude", pt[1])
                .put("packet", PacketsGoldenKit.request("gps", new CurrentGps(PacketsGoldenKit.params(), 1760326200, pt[0], pt[1]))));
        }
        root.put("requests", requests);

        // ---- forecasts
        JSONArray forecasts = GoldenSupport.arr();
        List<Weather.WeatherForecastData.TimeData> hours24 = new ArrayList<>();
        for (int i = 0; i < 24; i++) {
            hours24.add(hour(1760410800 + 3600 * i, icons[i % icons.length], 20 + i - 30, i == 5 ? null : (i * 4) % 101, i % 12));
        }
        List<Weather.WeatherForecastData.DayData> days8 = new ArrayList<>();
        for (int i = 0; i < 8; i++) {
            days8.add(day(1760412600 + 86400 * i, icons[(i * 5) % icons.length], 31 + i, 22 - i, 1760395200 + 86400 * i, 1760438400 + 86400 * i,
                0, 0, Weather.MoonPhase.values()[i % 8]));
        }
        forecasts.put(forecast("forecast all supported, 24 hours and 8 days", ALL, hours24, days8));
        forecasts.put(forecast("forecast nothing supported", "", hours24, days8));
        forecasts.put(forecast("forecast no hours", ALL, new ArrayList<>(), days8));
        forecasts.put(forecast("forecast null hours", ALL, null, days8.subList(0, 2)));
        forecasts.put(forecast("forecast no days", ALL, hours24.subList(0, 3), new ArrayList<>()));
        forecasts.put(forecast("forecast null days", ALL, hours24.subList(0, 3), null));
        forecasts.put(forecast("forecast both empty", ALL, new ArrayList<>(), new ArrayList<>()));
        forecasts.put(forecast("forecast hours need extended for precipitation", "icon,temp", hours24.subList(0, 4), days8.subList(0, 1)));
        forecasts.put(forecast("forecast hour temperature needs temp or current temp", "curTemp", hours24.subList(0, 4), null));
        forecasts.put(forecast("forecast hour temperature neither", "icon", hours24.subList(0, 4), null));
        forecasts.put(forecast("forecast extended hourly only", "extHourly", hours24.subList(0, 4), null));
        forecasts.put(forecast("forecast sun and moon", "sunrise,moon", null, days8.subList(0, 3)));
        forecasts.put(forecast("forecast sun only", "sunrise", null, days8.subList(0, 3)));
        forecasts.put(forecast("forecast moon only", "moon", null, days8.subList(0, 3)));
        forecasts.put(forecast("forecast temperatures only", "temp", null, days8.subList(0, 3)));
        List<Weather.WeatherForecastData.DayData> sparse = new ArrayList<>();
        sparse.add(day(100, null, null, null, null, null, null, null, null));
        sparse.add(day(200, Weather.WeatherIcon.SNOW, 1, -1, 0, 0, 0, 0, Weather.MoonPhase.FULL_MOON));
        sparse.add(day(300, Weather.WeatherIcon.SNOW, 1, -1, 1760395200, 0, 1760395300, 1760395400, Weather.MoonPhase.NEW_MOON));
        forecasts.put(forecast("forecast sparse days", ALL, null, sparse));
        List<Weather.WeatherForecastData.TimeData> sparseHours = new ArrayList<>();
        sparseHours.add(hour(100, null, null, null, null));
        sparseHours.add(hour(200, Weather.WeatherIcon.RAIN, -128, 127, 127));
        forecasts.put(forecast("forecast sparse hours", ALL, sparseHours, null));
        root.put("forecasts", forecasts);

        // ---- responses
        JSONArray responses = GoldenSupport.arr();
        for (int bitmap : new int[]{0x00, 0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0xFF, 0x55, 0xAA}) {
            responses.put(response("support bitmap " + bitmap, 0x02, new HuaweiTLV().put(0x01, (byte) bitmap)));
        }
        responses.put(response("support extra bytes", 0x02, b(0x01, 0x02, 0x7F, 0x01)));
        responses.put(response("support missing tag", 0x02, new HuaweiTLV().put(0x02, (byte) 1)));
        responses.put(response("support empty value", 0x02, new HuaweiTLV().put(0x01)));
        responses.put(response("support empty tlv", 0x02, new byte[0]));
        for (int bitmap : new int[]{0x0000, 0x0001, 0x0002, 0x0004, 0x0007, 0x0008, 0x0100, 0xFFFF, 0x8001}) {
            responses.put(response("extended bitmap " + bitmap, 0x06, new HuaweiTLV().put(0x01, (short) bitmap)));
        }
        responses.put(response("extended int bitmap", 0x06, new HuaweiTLV().put(0x01, 0x00010007)));
        responses.put(response("extended one byte", 0x06, new HuaweiTLV().put(0x01, (byte) 7)));
        responses.put(response("extended missing tag", 0x06, new HuaweiTLV().put(0x02, (byte) 1)));
        responses.put(response("extended empty tlv", 0x06, new byte[0]));
        for (int code : new int[]{0x000186A0, 0x000186A3, 0x000186A1, 0, -1, 100001}) {
            responses.put(response("start code " + code, 0x09, new HuaweiTLV().put(0x7F, code)));
        }
        responses.put(response("start missing code", 0x09, new HuaweiTLV().put(0x01, (byte) 1)));
        responses.put(response("start short code", 0x09, new HuaweiTLV().put(0x7F, (short) 5)));
        responses.put(response("start long code", 0x09, new HuaweiTLV().put(0x7F, 0x000186A0L)));
        responses.put(response("start empty tlv", 0x09, new byte[0]));
        for (int bitmap : new int[]{0, 1, 2, 3, 4, 0x100, -1}) {
            responses.put(response("sunmoon bitmap " + bitmap, 0x0a, new HuaweiTLV().put(0x01, bitmap)));
        }
        responses.put(response("sunmoon short", 0x0a, new HuaweiTLV().put(0x01, (short) 3)));
        responses.put(response("sunmoon one byte", 0x0a, new HuaweiTLV().put(0x01, (byte) 3)));
        responses.put(response("sunmoon missing tag", 0x0a, new HuaweiTLV().put(0x02, 3)));
        root.put("responses", responses);

        // ---- number formatting the Kotlin code takes from Java
        JSONArray formats = GoldenSupport.arr();
        double[] samples = {
            0, -0.0, 0.005, 0.015, 0.025, 0.125, 0.135, 1.005, 1.015, 1.025, 1.045, 2.675, -2.675, -6.9147444, -6.915, 107.6098111, 107.605, 107.615, -0.004, -0.005,
            0.994999, 0.995, 9.995, 99.995, 179.9999, 180, -180, 89.995, 12.345, 12.355, 51.5072, -0.1276, 1e-7, 4.9999999e-3, 5.0e-3, 1234567.125, 123456789.015,
            0.1, 0.2, 0.3, 0.7, 0.07, 0.057, 33.335, 33.345, 33.355, -33.865, 151.2093, 35.6762, 139.6503, -122.4194, 37.7749,
        };
        for (double v : samples) {
            formats.put(GoldenSupport.obj().put("value", v).put("bits", Double.doubleToRawLongBits(v))
                .put("coordinate", String.format(Locale.US, "%.2f", v))
                .put("rounded7", new BigDecimal(v).setScale(7, RoundingMode.HALF_UP).doubleValue()));
        }
        // Dense sweep of "ties": values built from decimal strings.
        for (int i = -200; i <= 200; i++) {
            double v = i / 8.0 + i * 1e-9;
            double w = i / 1000.0 + 0.0005;
            for (double x : new double[]{v, w, i * 0.005, i * 0.0000005}) {
                formats.put(GoldenSupport.obj().put("value", x).put("bits", Double.doubleToRawLongBits(x))
                    .put("coordinate", String.format(Locale.US, "%.2f", x))
                    .put("rounded7", new BigDecimal(x).setScale(7, RoundingMode.HALF_UP).doubleValue()));
            }
        }
        root.put("formats", formats);

        JSONArray encodings = GoldenSupport.arr();
        String[] names = {"Bandung", "S\u00e3o Paulo", "New York", "Bandung, Indonesia", "a+b", "a&b=c", "100%", "~tilde", "-_.*", "!'()", "\u4e2d\u6587", "\ud83d\ude00", "tab\there", "", " ", "/slash?q#frag", "caf\u00e9", "O'Brien", "\u00a0"};
        for (String n : names) {
            encodings.put(GoldenSupport.obj().put("text", n).put("encoded", URLEncoder.encode(n, "UTF-8")));
        }
        root.put("encodings", encodings);

        JSONArray moon = GoldenSupport.arr();
        long[] epochs = {1704974220L, 1706205240L, 0L, 946728000L, 1760412600L, 1760326200L, 2000000000L, 4102444800L, -86400L, 1700000000L, 1234567890L};
        for (long e : epochs) {
            int deg = moonPhaseDegrees(e);
            Weather.MoonPhase phase = Weather.degreesToMoonPhase(deg);
            moon.put(GoldenSupport.obj().put("epoch", e).put("degrees", deg).put("phase", nul(phase == null ? null : phase.name())));
        }
        for (int i = 0; i < 120; i++) {
            long e = 1760400000L + i * 86400L * 3 + i * 977;
            int deg = moonPhaseDegrees(e);
            Weather.MoonPhase phase = Weather.degreesToMoonPhase(deg);
            moon.put(GoldenSupport.obj().put("epoch", e).put("degrees", deg).put("phase", nul(phase == null ? null : phase.name())));
        }
        root.put("moon", moon);

        JSONArray phases = GoldenSupport.arr();
        for (int deg = -2; deg <= 362; deg++) {
            Weather.MoonPhase phase = Weather.degreesToMoonPhase(deg);
            phases.put(GoldenSupport.obj().put("degrees", deg).put("phase", nul(phase == null ? null : phase.name())));
        }
        root.put("phases", phases);

        GoldenSupport.write(args[0], "packetsWeather.json", root);
    }
}

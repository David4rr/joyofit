// Calorie intake on the watch. Port of DietSync.kt's pure parts (DietMeal, DietGoals, DietDay, DietEntry, DietPlanner): layouts and rules as
// Huawei Health 17.0.8.300 behaves: meal list, placeholders, 42 cap, extra slots with ExpandCapability 215, recommended ranges, config ids
// 900300023 / 900300022, events 80030003 / 80030004 and the JSON shapes. UNVERIFIED on the Fit 4 Pro: nothing here was ever sent to a watch
// before JoyoFit. Foundation only.
import Foundation

/// One meal as JS hands it over, or as the watch quick-logged it. `eatTime` is Unix seconds.
public struct DietMeal: Equatable, Sendable {
    public var id: String
    public var eatTime: Int64
    public var kcal: Double
    /// 10 breakfast, 20 lunch, 30 dinner, 40 other; 11 / 21 / 31 extra slots (kept only with ExpandCapability 215).
    public var whichMeal: Int
    public var carbs: Double?
    public var protein: Double?
    public var fat: Double?
    /// `app` (from JS) or `watch` (quick-logged on the watch).
    public var src: String
    /// False for a watch meal JS has not yet written to JoyoRogo; such meals survive the next `setDay`.
    public var synced: Bool

    public init(
        id: String, eatTime: Int64, kcal: Double, whichMeal: Int, carbs: Double? = nil, protein: Double? = nil, fat: Double? = nil, src: String = "app",
        synced: Bool = true
    ) {
        self.id = id
        self.eatTime = eatTime
        self.kcal = kcal
        self.whichMeal = whichMeal
        self.carbs = carbs
        self.protein = protein
        self.fat = fat
        self.src = src
        self.synced = synced
    }

    /// The stored form (`diet_day.meals_json`); the optional macros are left out when unknown, as on Android.
    public func toJson() -> [String: Any] {
        var o: [String: Any] = ["id": id, "eatTime": eatTime, "kcal": kcal, "whichMeal": whichMeal, "src": src, "synced": synced]
        if let carbs { o["carbs"] = carbs }
        if let protein { o["protein"] = protein }
        if let fat { o["fat"] = fat }
        return o
    }

    /// `WatchLoggedMeal` / the meals of `DietStatus`: the macros are `null` when unknown.
    public func toJS() -> [String: Any] {
        [
            "id": id, "eatTime": eatTime, "kcal": kcal, "whichMeal": whichMeal, "carbs": carbs.map { $0 as Any } ?? NSNull(),
            "protein": protein.map { $0 as Any } ?? NSNull(), "fat": fat.map { $0 as Any } ?? NSNull(), "src": src, "synced": synced,
        ]
    }

    public static func fromJson(_ o: [String: Any]) -> DietMeal {
        let id = DietJson.optString(o, "id") ?? ""
        return DietMeal(
            id: id.isEmpty ? UUID().uuidString : id,
            eatTime: DietJson.optLong(o, "eatTime") ?? 0,
            kcal: DietJson.optDouble(o, "kcal") ?? 0,
            whichMeal: DietJson.optInt(o, "whichMeal") ?? 40,
            carbs: o["carbs"] == nil ? nil : DietJson.optDouble(o, "carbs"),
            protein: o["protein"] == nil ? nil : DietJson.optDouble(o, "protein"),
            fat: o["fat"] == nil ? nil : DietJson.optDouble(o, "fat"),
            src: DietJson.optString(o, "src") ?? "app",
            synced: DietJson.optBool(o, "synced") ?? true
        )
    }
}

/// The day's goals: the diet config (`900300023`) plus the weight goal (`900300022`).
public struct DietGoals: Equatable, Sendable {
    public var dailyKcal: Int
    /// Planned daily kcal deficit (`caloricDeficitGoal`); 0 when maintaining.
    public var deficitKcal: Int
    public var weightInitKg: Double?
    public var targetWeightKg: Double?
    /// 0 maintain, 1 lose, 2 gain.
    public var weightManagerType: Int
    /// Daily active kcal goal (`activityCalGoal`); nil uses the activity-ring calories goal.
    public var activityCalGoal: Int?

    public init(
        dailyKcal: Int, deficitKcal: Int = 0, weightInitKg: Double? = nil, targetWeightKg: Double? = nil, weightManagerType: Int = 0,
        activityCalGoal: Int? = nil
    ) {
        self.dailyKcal = dailyKcal
        self.deficitKcal = deficitKcal
        self.weightInitKg = weightInitKg
        self.targetWeightKg = targetWeightKg
        self.weightManagerType = weightManagerType
        self.activityCalGoal = activityCalGoal
    }

    public func toJson() -> [String: Any] {
        var o: [String: Any] = ["dailyKcal": dailyKcal, "deficitKcal": deficitKcal, "weightManagerType": weightManagerType]
        if let weightInitKg { o["weightInitKg"] = weightInitKg }
        if let targetWeightKg { o["targetWeightKg"] = targetWeightKg }
        if let activityCalGoal { o["activityCalGoal"] = activityCalGoal }
        return o
    }

    /// `DietGoals` of `DietStatus`: every field is present, unset ones are `null`.
    public func toJS() -> [String: Any] {
        [
            "dailyKcal": dailyKcal, "deficitKcal": deficitKcal, "weightInitKg": weightInitKg.map { $0 as Any } ?? NSNull(),
            "targetWeightKg": targetWeightKg.map { $0 as Any } ?? NSNull(), "weightManagerType": weightManagerType,
            "activityCalGoal": activityCalGoal.map { $0 as Any } ?? NSNull(),
        ]
    }

    public static func fromJson(_ o: [String: Any]) -> DietGoals? {
        if o["dailyKcal"] == nil { return nil }
        return DietGoals(
            dailyKcal: DietJson.optInt(o, "dailyKcal") ?? 0,
            deficitKcal: DietJson.optInt(o, "deficitKcal") ?? 0,
            weightInitKg: o["weightInitKg"] == nil ? nil : DietJson.optDouble(o, "weightInitKg"),
            targetWeightKg: o["targetWeightKg"] == nil ? nil : DietJson.optDouble(o, "targetWeightKg"),
            weightManagerType: DietJson.optInt(o, "weightManagerType") ?? 0,
            activityCalGoal: o["activityCalGoal"] == nil ? nil : DietJson.optInt(o, "activityCalGoal")
        )
    }
}

/// The latest stored day (`diet_day`). `date` is the local `YYYY-MM-DD`.
public struct DietDay: Equatable, Sendable {
    public var date: String
    public var meals: [DietMeal]
    public var goals: DietGoals?
    public var updatedAt: Int64
    public var pushedAt: Int64?

    public init(date: String, meals: [DietMeal], goals: DietGoals?, updatedAt: Int64 = 0, pushedAt: Int64? = nil) {
        self.date = date
        self.meals = meals
        self.goals = goals
        self.updatedAt = updatedAt
        self.pushedAt = pushedAt
    }

    public var intakeKcal: Double { meals.reduce(0) { $0 + $1.kcal } }
}

/// `DietDay` of `HuaweiWearDiet.types.ts` as JS hands it over (Android's `DietDayRecord`): defaults as the Record's.
public struct DietDayArgument: Equatable, Sendable {
    public var date: String
    public var meals: [DietMeal]
    public var goals: DietGoals?

    public init?(js: [String: Any]) {
        date = DietJson.optString(js, "date") ?? ""
        let rawMeals = js["meals"] as? [Any] ?? []
        var meals: [DietMeal] = []
        for (index, element) in rawMeals.enumerated() {
            guard let m = element as? [String: Any] else { return nil }
            let id = DietJson.optString(m, "id")
            meals.append(
                DietMeal(
                    id: id ?? "app-\(date)-\(index)", eatTime: DietJson.optLong(m, "eatTime") ?? 0, kcal: DietJson.optDouble(m, "kcal") ?? 0,
                    whichMeal: DietJson.optInt(m, "whichMeal") ?? 40, carbs: DietJson.optDouble(m, "carbs"), protein: DietJson.optDouble(m, "protein"),
                    fat: DietJson.optDouble(m, "fat")
                )
            )
        }
        self.meals = meals
        if let g = js["goals"] as? [String: Any] {
            goals = DietGoals(
                dailyKcal: DietJson.optInt(g, "dailyKcal") ?? 0, deficitKcal: DietJson.optInt(g, "deficitKcal") ?? 0,
                weightInitKg: DietJson.optDouble(g, "weightInitKg"), targetWeightKg: DietJson.optDouble(g, "targetWeightKg"),
                weightManagerType: DietJson.optInt(g, "weightManagerType") ?? 0, activityCalGoal: DietJson.optInt(g, "activityCalGoal")
            )
        } else {
            goals = nil
        }
    }
}

/// One element of the meals array the watch gets (JSON field order).
public struct DietEntry: Equatable, Sendable {
    public var eatTime: Int64
    public var hasFood: Bool
    public var kcal: Float
    /// nil leaves `sugRange` out (Gson omits null), an empty array writes `[]` (what Huawei's `int[0]` does).
    public var sugRange: [Int]?
    public var whichMeal: Int

    public init(eatTime: Int64, hasFood: Bool, kcal: Float, sugRange: [Int]?, whichMeal: Int) {
        self.eatTime = eatTime
        self.hasFood = hasFood
        self.kcal = kcal
        self.sugRange = sugRange
        self.whichMeal = whichMeal
    }
}

/// Pure planning: ranges, the meal list, the config JSON. No I/O, so the byte examples can be tested.
public enum DietPlanner {
    public static let phonePkg = "hw.unitedevice.weightMgr"
    public static let watchPkg = "hw.sport.dietcal"
    public static let commonPkg = "hw.unitedevice.common"

    public static let dictDiet = 600_002
    public static let configDiet = 900_300_023
    public static let configWeightGoal = 900_300_022
    public static let eventDiet = 80_030_003
    public static let eventVip = 80_030_004

    /// ExpandCapability: extra meal slots and the watch quick-log reply.
    public static let capExtraMeals = 215

    /// `if (size > 42) return`: no more than this many entries go to the watch.
    public static let maxEntries = 42

    private struct Ratio {
        let lo: Float
        let hi: Float
    }

    /// Table for region `it` (Huawei's default outside cn / de): key `<manager type>_<day has an extra meal of this group>_<meal>`.
    /// The extra-slot ranges are (0, 0.05). There is no entry for 40; see `range`.
    private static let ratios: [String: Ratio] = {
        var m: [String: Ratio] = [:]
        func put(_ type: Int, _ add: Int, _ meal: Int, _ lo: Float, _ hi: Float) { m["\(type)_\(add)_\(meal)"] = Ratio(lo: lo, hi: hi) }
        put(0, 0, 10, 0.2, 0.26); put(0, 0, 20, 0.4, 0.47); put(0, 0, 30, 0.3, 0.35)
        put(0, 1, 10, 0.15, 0.21); put(0, 1, 20, 0.35, 0.42); put(0, 1, 30, 0.25, 0.3)
        put(1, 0, 10, 0.25, 0.32); put(1, 0, 20, 0.4, 0.47); put(1, 0, 30, 0.25, 0.3)
        put(1, 1, 10, 0.2, 0.27); put(1, 1, 20, 0.35, 0.42); put(1, 1, 30, 0.2, 0.25)
        put(2, 0, 10, 0.25, 0.3); put(2, 0, 20, 0.4, 0.5); put(2, 0, 30, 0.28, 0.35)
        put(2, 1, 10, 0.2, 0.25); put(2, 1, 20, 0.35, 0.45); put(2, 1, 30, 0.23, 0.3)
        for type in 0...2 { for meal in [11, 21, 31] { put(type, 1, meal, 0, 0.05) } }
        return m
    }()

    /// The "snack" slot has no entry in Huawei's table (its range comes from a cloud config we do not have); 0 to 5 % of the day goal is our choice.
    private static let snackRatio = Ratio(lo: 0, hi: 0.05)

    public static func isMealType(_ which: Int) -> Bool { [10, 11, 20, 21, 30, 31, 40].contains(which) }

    /// Without ExpandCapability 215 the extra slots are folded into 40.
    public static func fold(_ which: Int, extraSlots: Bool) -> Int { !extraSlots && (which == 11 || which == 21 || which == 31) ? 40 : which }

    /// Does the day have an extra meal in the group of `meal`.
    private static func hasExtra(_ extras: Set<Int>, _ meal: Int) -> Bool {
        switch meal {
        case 10, 11: return extras.contains(11)
        case 20, 21: return extras.contains(21)
        default: return extras.contains(31)
        }
    }

    /// Java's `Math.round`: floor(x + 0.5), exact for the doubles and floats used here.
    private static func javaRound(_ x: Double) -> Int { Int((x + 0.5).rounded(.down)) }

    /// `[round(lo * goal), round(hi * goal)]`; empty when the goal is not positive.
    public static func range(goalKcal: Int, which: Int, managerType: Int, extras: Set<Int>) -> [Int] {
        if goalKcal <= 0 { return [] }
        let ratio: Ratio
        if which == 40 {
            ratio = snackRatio
        } else if let r = ratios["\(managerType)_\(hasExtra(extras, which) ? 1 : 0)_\(which)"] {
            ratio = r
        } else {
            return []
        }
        let goal = Double(goalKcal)
        return [javaRound(Double(ratio.lo) * goal), javaRound(Double(ratio.hi) * goal)]
    }

    /// The meal array for one day: merged meals per type, the 40 sum, then placeholders for today.
    public static func entries(day: DietDay, extraSlots: Bool, todayDate: String, todayStartSec: Int64) -> [DietEntry] {
        let goal = day.goals?.dailyKcal ?? 0
        let managerType = day.goals?.weightManagerType ?? 0
        let extras = Set(day.meals.map(\.whichMeal).filter { $0 == 11 || $0 == 21 || $0 == 31 })

        // Meals of the same type are one entry (kcal summed, first time kept). `sortedBy` is stable.
        var order: [Int] = []
        var merged: [Int: (Int64, Double)] = [:]
        let sorted = day.meals.enumerated().sorted { ($0.element.whichMeal, $0.offset) < ($1.element.whichMeal, $1.offset) }.map(\.element)
        for meal in sorted {
            if let prior = merged[meal.whichMeal] {
                merged[meal.whichMeal] = (prior.0, prior.1 + meal.kcal)
            } else {
                order.append(meal.whichMeal)
                merged[meal.whichMeal] = (meal.eatTime, meal.kcal)
            }
        }

        var list: [DietEntry] = []
        var snackKcal: Float = 0
        var snackTime: Int64 = 0
        var snackMax = 0
        var snackSeen = false
        for original in order {
            if list.count >= maxEntries { return list }
            let (time, kcal) = merged[original]!
            let own = range(goalKcal: goal, which: original, managerType: managerType, extras: extras)
            let which = fold(original, extraSlots: extraSlots)
            if which == 40 {
                snackKcal += Float(kcal)
                snackTime = time
                snackMax += own.count > 1 ? own[1] : 0
                snackSeen = true
            } else {
                list.append(DietEntry(eatTime: time, hasFood: true, kcal: Float(kcal), sugRange: own.count == 2 ? own : nil, whichMeal: which))
            }
        }
        if snackSeen { list.append(DietEntry(eatTime: snackTime, hasFood: true, kcal: snackKcal, sugRange: [0, snackMax], whichMeal: 40)) }

        if day.date == todayDate {
            let present = Set(list.map(\.whichMeal))
            func placeholder(_ which: Int) {
                if list.count >= maxEntries { return }
                list.append(
                    DietEntry(eatTime: todayStartSec, hasFood: false, kcal: 0, sugRange: range(goalKcal: goal, which: which, managerType: managerType, extras: extras), whichMeal: which)
                )
            }
            if !present.contains(10) { placeholder(10) }
            if !present.contains(20) { placeholder(20) }
            if !present.contains(30) { placeholder(30) }
            if !present.contains(40) && !extraSlots { placeholder(40) }
        }
        return list
    }

    /// `[{"eatTime":..,"hasFood":..,"kiloCalorie":..,"sugRange":[..],"whichMeal":..}]`, compact, as Gson writes it.
    public static func mealsJson(_ entries: [DietEntry]) -> Bytes {
        DietJson.bytes(
            .array(
                entries.map { e in
                    var fields: [(String, DietJson)] = [("eatTime", .int(e.eatTime)), ("hasFood", .bool(e.hasFood)), ("kiloCalorie", .float(e.kcal))]
                    if let range = e.sugRange { fields.append(("sugRange", .array(range.map { .int(Int64($0)) }))) }
                    fields.append(("whichMeal", .int(Int64(e.whichMeal))))
                    return .object(fields)
                }
            )
        )
    }

    /// `{"dietaryAnalysis":{"coefficient":1,"carbohydrates":g,"protein":g,"fat":g}}` for the day's macros; nil when none are known.
    public static func analysisJson(_ day: DietDay) -> Bytes? {
        let withMacros = day.meals.filter { $0.carbs != nil || $0.protein != nil || $0.fat != nil }
        if withMacros.isEmpty { return nil }
        let inner: DietJson = .object([
            ("coefficient", .int(1)),
            ("carbohydrates", .float(Float(withMacros.reduce(0.0) { $0 + ($1.carbs ?? 0) }))),
            ("protein", .float(Float(withMacros.reduce(0.0) { $0 + ($1.protein ?? 0) }))),
            ("fat", .float(Float(withMacros.reduce(0.0) { $0 + ($1.fat ?? 0) }))),
        ])
        return DietJson.bytes(.object([("dietaryAnalysis", inner)]))
    }

    /// Config JSON in field order: onePointFull{dinner,lunch,breakfast}, caloricDeficitGoal, weightInit, activityCalGoal, fatLossRatio,
    /// weightManagerType. `onePointFull` is `round((min + max) / 14)` of each meal's range; fatLossRatio is the default Huawei Health fills in
    /// when the user has none; proportionMeal is null and so left out.
    public static func configJson(_ goals: DietGoals, activityCalGoal: Int, weightInitKg: Double?) -> Bytes {
        func onePoint(_ meal: Int) -> Int {
            let r = range(goalKcal: goals.dailyKcal, which: meal, managerType: goals.weightManagerType, extras: [])
            return r.count < 2 ? 0 : javaRound(Double(Float(r[0] + r[1]) / 14.0))
        }
        let out: DietJson = .object([
            ("onePointFull", .object([("dinner", .int(Int64(onePoint(30)))), ("lunch", .int(Int64(onePoint(20)))), ("breakfast", .int(Int64(onePoint(10))))])),
            ("caloricDeficitGoal", .int(Int64(goals.deficitKcal))),
            ("weightInit", .float(Float(weightInitKg ?? 0))),
            ("activityCalGoal", .int(Int64(activityCalGoal))),
            ("fatLossRatio", .object([("maxRatio", .float(0)), ("minRatio", .float(0)), ("maxWeek", .int(0)), ("gear", .int(1))])),
            ("weightManagerType", .int(Int64(goals.weightManagerType))),
        ])
        return DietJson.bytes(out)
    }

    /// `{"weightGoal":<double>}`.
    public static func weightGoalJson(_ kg: Double) -> Bytes { DietJson.bytes(.object([("weightGoal", .double(kg))])) }

    /// The reply to a quick-logged meal.
    public static func punchReply(resultCode: Int, failTimeSec: Int64) -> Bytes {
        var fields: [(String, DietJson)] = [("punchResult", .int(Int64(resultCode)))]
        if resultCode != 0 { fields.append(("punchFailTime", .int(failTimeSec))) }
        fields.append(("event", .int(6)))
        return DietJson.bytes(.object(fields))
    }

    /// Parses the watch's `{"meals":[...]}` (the array may also arrive as a string, as Huawei's `getString("meals")` allows).
    public static func parseQuickLog(_ json: [String: Any], nowSec: Int64) -> [DietMeal] {
        let array: [Any]
        switch json["meals"] {
        case let a as [Any]: array = a
        case let s as String:
            guard let data = s.data(using: .utf8), let parsed = (try? JSONSerialization.jsonObject(with: data)) as? [Any] else { return [] }
            array = parsed
        default: return []
        }
        var out: [DietMeal] = []
        for (i, element) in array.enumerated() {
            guard let o = element as? [String: Any] else { continue }
            let which = DietJson.optInt(o, "whichMeal") ?? 0
            // whichMeal 0 is an error and skipped.
            if which == 0 { continue }
            var time = DietJson.optLong(o, "eatTime") ?? 0
            if time >= 1_000_000_000_000 { time /= 1000 }
            if time <= 0 { time = nowSec }
            out.append(
                DietMeal(
                    id: "watch-\(time)-\(which)-\(i)", eatTime: time, kcal: DietJson.optDouble(o, "kiloCalorie") ?? 0, whichMeal: which, src: "watch",
                    synced: false
                )
            )
        }
        return out
    }

    /// An event body that is a JSON object; nil when empty or not an object.
    public static func parseObject(_ data: Bytes?) -> [String: Any]? {
        guard let data, !data.isEmpty else { return nil }
        return (try? JSONSerialization.jsonObject(with: Data(data))) as? [String: Any]
    }

    /// `DataSyncBytes.readInt32`: up to four big-endian bytes.
    public static func readInt32(_ bytes: Bytes?) -> Int32? {
        guard let bytes, !bytes.isEmpty, bytes.count <= 4 else { return nil }
        var n: UInt32 = 0
        for b in bytes { n = (n << 8) | UInt32(b) }
        return Int32(bitPattern: n)
    }
}

/// A JSON value written the way Kotlin's `DataSyncJson` does (compact, insertion order, Java's number formatting), plus the lenient
/// `JSONObject.optX` readers the Android code relies on.
public indirect enum DietJson {
    case null
    case bool(Bool)
    case int(Int64)
    case float(Float)
    case double(Double)
    case string(String)
    case array([DietJson])
    case object([(String, DietJson)])

    public static func bytes(_ value: DietJson) -> Bytes { Bytes(value.write().utf8) }

    public func write() -> String {
        var out = ""
        append(&out)
        return out
    }

    private func append(_ out: inout String) {
        switch self {
        case .null: out += "null"
        case .bool(let b): out += b ? "true" : "false"
        case .int(let n): out += String(n)
        case .float(let f): out += f.isFinite ? DietJson.javaString(digitsOf: "\(f)", negative: f.sign == .minus, isZero: f == 0) : "null"
        case .double(let d): out += d.isFinite ? DietJson.javaString(digitsOf: "\(d)", negative: d.sign == .minus, isZero: d == 0) : "null"
        case .string(let s): DietJson.appendString(&out, s)
        case .array(let items):
            out += "["
            for (i, item) in items.enumerated() {
                if i > 0 { out += "," }
                item.append(&out)
            }
            out += "]"
        case .object(let fields):
            out += "{"
            for (i, field) in fields.enumerated() {
                if i > 0 { out += "," }
                DietJson.appendString(&out, field.0)
                out += ":"
                field.1.append(&out)
            }
            out += "}"
        }
    }

    private static func appendString(_ out: inout String, _ value: String) {
        out += "\""
        for u in value.unicodeScalars {
            switch u {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            default:
                if u.value < 0x20 {
                    let hex = String(u.value, radix: 16)
                    out += "\\u" + String(repeating: "0", count: 4 - hex.count) + hex
                } else {
                    out.unicodeScalars.append(u)
                }
            }
        }
        out += "\""
    }

    /// Java's `Float.toString` / `Double.toString` from Swift's shortest-digits description: decimal form for 1e-3 <= |x| < 1e7 with at least
    /// one fraction digit, otherwise computerized scientific notation (`1.0E7`, `1.5E-4`).
    static func javaString(digitsOf description: String, negative: Bool, isZero: Bool) -> String {
        if isZero { return negative ? "-0.0" : "0.0" }
        var text = description
        if text.hasPrefix("-") { text.removeFirst() }
        var exponent = 0
        if let e = text.firstIndex(where: { $0 == "e" || $0 == "E" }) {
            exponent = Int(text[text.index(after: e)...].replacingOccurrences(of: "+", with: "")) ?? 0
            text = String(text[..<e])
        }
        let parts = text.split(separator: ".", omittingEmptySubsequences: false)
        let whole = String(parts[0])
        let fraction = parts.count > 1 ? String(parts[1]) : ""
        var digits = Array(whole + fraction)
        var point = whole.count + exponent
        while digits.first == "0" {
            digits.removeFirst()
            point -= 1
        }
        while digits.last == "0" { digits.removeLast() }
        let sign = negative ? "-" : ""
        if digits.isEmpty { return sign + "0.0" }
        let ds = String(digits)
        // value = 0.ds x 10^point, so the scientific exponent is point - 1; decimal form holds for 1e-3 <= |x| < 1e7.
        if point > -3 && point <= 7 {
            if point <= 0 { return sign + "0." + String(repeating: "0", count: -point) + ds }
            if point >= digits.count { return sign + ds + String(repeating: "0", count: point - digits.count) + ".0" }
            let i = ds.index(ds.startIndex, offsetBy: point)
            return sign + ds[..<i] + "." + ds[i...]
        }
        let rest = digits.count > 1 ? String(digits.dropFirst()) : "0"
        return sign + String(digits[0]) + "." + rest + "E" + String(point - 1)
    }

    // MARK: lenient readers (org.json's optInt / optLong / optDouble / optString / optBoolean)

    public static func optDouble(_ o: [String: Any], _ key: String) -> Double? {
        switch o[key] {
        case let n as NSNumber where !isBool(n): return n.doubleValue
        case let s as String: return Double(s.trimmingCharacters(in: .whitespaces))
        default: return nil
        }
    }

    public static func optLong(_ o: [String: Any], _ key: String) -> Int64? {
        switch o[key] {
        case let n as NSNumber where !isBool(n): return clampedLong(n)
        case let s as String:
            let t = s.trimmingCharacters(in: .whitespaces)
            if let n = Int64(t) { return n }
            return Double(t).map { clampedLong(NSNumber(value: $0)) }
        default: return nil
        }
    }

    public static func optInt(_ o: [String: Any], _ key: String) -> Int? {
        optLong(o, key).map { Int(Int32(truncatingIfNeeded: $0)) }
    }

    public static func optString(_ o: [String: Any], _ key: String) -> String? {
        switch o[key] {
        case let s as String: return s
        case let n as NSNumber: return isBool(n) ? (n.boolValue ? "true" : "false") : "\(n)"
        default: return nil
        }
    }

    public static func optBool(_ o: [String: Any], _ key: String) -> Bool? {
        switch o[key] {
        case let n as NSNumber: return n.boolValue
        case let s as String: return s.lowercased() == "true" ? true : s.lowercased() == "false" ? false : nil
        default: return nil
        }
    }

    /// `JSONSerialization` returns booleans as NSNumber too; their Objective-C type is `c`, a parsed number's never is.
    private static func isBool(_ n: NSNumber) -> Bool { String(cString: n.objCType) == "c" }

    private static func clampedLong(_ n: NSNumber) -> Int64 {
        let d = n.doubleValue
        if d.isNaN { return 0 }
        if d >= 9.2233720368547758e18 { return Int64.max }
        if d <= -9.2233720368547758e18 { return Int64.min }
        return n.int64Value
    }
}

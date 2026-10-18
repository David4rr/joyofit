// Port of ProfileSender.kt (GB SendFitnessUserInfoRequest + SendFitnessGoalRequest): the profile and daily step goal the user saved. The
// notification switch of the Kotlin object is not ported with the notification layer.
import Foundation

/// Profile and goal as the JS Settings screen stores them (`UserProfile` in `HuaweiWear.types.ts`).
public struct UserProfileData: Equatable, Sendable {
    public var heightCm: Int
    public var weightKg: Double
    public var birthYear: Int
    /// `male`, `female` or `unknown`.
    public var sex: String
    public var dailyStepGoal: Int

    public init(heightCm: Int, weightKg: Double, birthYear: Int, sex: String, dailyStepGoal: Int) {
        self.heightCm = heightCm
        self.weightKg = weightKg
        self.birthYear = birthYear
        self.sex = sex
        self.dailyStepGoal = dailyStepGoal
    }
}

/// Sends the profile/goal; each request only when the watch lists its command.
public enum ProfileSender {
    /// GB `ActivityUser.getAge()` for a birth date of 1 January of `birthYear`.
    public static func age(birthYear: Int, now: Date = Date(), calendar: Calendar = .current) -> Int {
        max(0, calendar.component(.year, from: now) - birthYear)
    }

    /// SendFitnessUserInfoRequest: `year << 16 | month << 8 | day` for 1 January.
    public static func encodeBirthday(birthYear: Int) -> Int32 {
        Int32(truncatingIfNeeded: (birthYear << 16) + (1 << 8) + 1)
    }

    static func genderByte(_ sex: String) -> UInt8 {
        switch sex {
        case "male": return UInt8(FitnessData.UserInfo.UserInfoData.genderMale)
        case "female": return UInt8(FitnessData.UserInfo.UserInfoData.genderFemale)
        default: return UInt8(FitnessData.UserInfo.UserInfoData.genderUnknown)
        }
    }

    /// SendFitnessUserInfoRequest (07/02) then SendFitnessGoalRequest (07/01). Returns how many of the two the watch acknowledged. A command
    /// missing from SupportedCommands is skipped, as GB does for the goal (`supportsMotionGoal`); for the user info it is skipped here too
    /// so an old watch is not sent a command it never listed.
    @discardableResult
    public static func sendProfile(
        session: HuaweiSession, caps: DeviceCaps, log: @escaping LogSink, profile: UserProfileData,
        now: Date = Date(), calendar: Calendar = .current, timeoutMs: Int = Timeouts.initMs
    ) async throws -> Int {
        var sent = 0
        if caps.supports(Int(FitnessData.id), Int(FitnessData.UserInfo.id)) {
            let data = FitnessData.UserInfo.UserInfoData(
                height: Int32(truncatingIfNeeded: profile.heightCm),
                weight: Float(profile.weightKg),
                age: Int32(truncatingIfNeeded: age(birthYear: profile.birthYear, now: now, calendar: calendar)),
                birthday: encodeBirthday(birthYear: profile.birthYear),
                gender: genderByte(profile.sex),
                unknownGenderSupported: caps.expandCapability(0x57), // HuaweiState.supportsUnknownGender
                vo2Supported: false, // vo2 not supported (GB leaves it disabled too)
                vo2Max: 0,
                vo2Time: 0,
                precisionWeightSupported: caps.expandCapability(0xb3) // HuaweiState.supportsPrecisionWeight
            )
            _ = try await session.request(FitnessData.UserInfo.request(info: data), timeoutMs: timeoutMs, label: "FitnessUserInfo")
            log(LogEntry(.info, "FitnessUserInfo: \(profile.heightCm) cm, \(profile.weightKg) kg, born \(profile.birthYear), \(profile.sex)"))
            sent += 1
        }
        if caps.supports(Int(FitnessData.id), Int(FitnessData.MotionGoal.id)) {
            let request = FitnessData.MotionGoal.request(
                goalType: 0x01, frameType: 0x00, stepGoal: Int32(truncatingIfNeeded: profile.dailyStepGoal),
                calorieGoal: 0, // calorie goal: GB sends 0 until it has a UI
                durationGoal: 0
            )
            _ = try await session.request(request, timeoutMs: timeoutMs, label: "FitnessGoal")
            log(LogEntry(.info, "FitnessGoal: \(profile.dailyStepGoal) steps"))
            sent += 1
        }
        return sent
    }
}

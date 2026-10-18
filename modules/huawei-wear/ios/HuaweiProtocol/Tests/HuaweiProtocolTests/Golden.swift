import Foundation
import XCTest
@testable import HuaweiProtocol

/// Loads Fixtures/<name>.json, produced by GoldenGen/run.sh from the Java the Android app runs.
enum Golden {
    static func load(_ name: String) throws -> [String: Any] {
        let url = URL(fileURLWithPath: #filePath).deletingLastPathComponent().appendingPathComponent("Fixtures/\(name).json")
        let data = try Data(contentsOf: url)
        guard let root = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw NSError(domain: "Golden", code: 1, userInfo: [NSLocalizedDescriptionKey: "\(name).json is not an object"])
        }
        return root
    }
}

extension Dictionary where Key == String, Value == Any {
    func list(_ key: String) -> [[String: Any]] { (self[key] as? [[String: Any]]) ?? [] }
    func str(_ key: String) -> String { (self[key] as? String) ?? "" }
    func opt(_ key: String) -> String? { self[key] as? String }
    func int(_ key: String) -> Int { (self[key] as? NSNumber)?.intValue ?? 0 }
    func bool(_ key: String) -> Bool { (self[key] as? NSNumber)?.boolValue ?? false }
    func bytes(_ key: String) -> Bytes { Bytes(hex: str(key)) ?? [] }
    func optBytes(_ key: String) -> Bytes? { opt(key).flatMap { Bytes(hex: $0) } }
}

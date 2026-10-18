// swift-tools-version:5.9
import PackageDescription

// Logic tests for the iOS native layer of modules/huawei-wear that run on Linux and macOS.
//
// The target `HuaweiWearLogic` is built the way the CocoaPods pod is: ONE Swift module that holds the HuaweiProtocol sources and the
// module's own sources (symlinked from ../ and ../HuaweiProtocol/Sources). Files that need Apple frameworks (CoreBluetooth, Security,
// HealthKit, ExpoModulesCore) are wrapped in `#if canImport(...)` and compile to nothing here.
let package = Package(
    name: "ModuleLogicTests",
    platforms: [.iOS(.v15), .macOS(.v12)],
    targets: [
        .systemLibrary(name: "CSQLite"),
        .target(
            name: "HuaweiWearLogic",
            dependencies: ["CSQLite"]
        ),
        .testTarget(
            name: "HuaweiWearLogicTests",
            dependencies: ["HuaweiWearLogic"]
        ),
    ]
)

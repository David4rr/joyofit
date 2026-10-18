// swift-tools-version:5.9
import PackageDescription

// Pure Swift port of the Huawei watch link protocol (Gadgetbridge, AGPL-3.0-or-later; see NOTICE).
// No dependencies: the crypto (SHA-256, HMAC, HKDF, PBKDF2, AES-CBC/GCM) is in the package so the same sources
// compile under SwiftPM on Linux (tests against Java golden vectors) and inside the CocoaPods module on iOS.
let package = Package(
    name: "HuaweiProtocol",
    platforms: [.iOS(.v15), .macOS(.v12)],
    products: [
        .library(name: "HuaweiProtocol", targets: ["HuaweiProtocol"]),
    ],
    targets: [
        .target(name: "HuaweiProtocol"),
        .testTarget(
            name: "HuaweiProtocolTests",
            dependencies: ["HuaweiProtocol"],
            exclude: ["Fixtures"]
        ),
    ]
)

// The HTTP GET behind `WeatherFetch`: URLSession, with the headers and timeouts of OpenMeteo.get in OpenMeteo.kt (connect 10 s, read 15 s,
// `Accept: application/json`, `User-Agent: JoyoFit`) and the same "HTTP <status>: <first 200 characters>" error for a non-2xx answer.
import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif
#if canImport(HuaweiProtocol)
import HuaweiProtocol
#endif

public enum WeatherNetwork {
    private static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.timeoutIntervalForRequest = 15
        configuration.timeoutIntervalForResource = 30
        return URLSession(configuration: configuration)
    }()

    public static let fetch: WeatherFetch = { urlString in
        guard let url = URL(string: urlString) else { throw OpenMeteoBadResponse("Not a URL: \(urlString)") }
        var request = URLRequest(url: url)
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("JoyoFit", forHTTPHeaderField: "User-Agent")
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        let body = String(decoding: data, as: UTF8.self)
        if !(200...299).contains(status) {
            let reason = String(body.prefix(200))
            throw OpenMeteoBadResponse("Open-Meteo answered HTTP \(status)\(reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? "" : ": \(reason)")")
        }
        return body
    }
}

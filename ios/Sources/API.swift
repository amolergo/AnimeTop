import Foundation
import SwiftUI
import WebKit

let site = URL(string: "https://kawaiiflex.103.118.210.148.sslip.io")!
struct TitleItem: Identifiable, Hashable {
    let id: String
    let title: String
    let aliases: [String]
    let poster: String
    let mode: String
    let year: Int?
    let genres: [String]
    let type: String
    init(_ value: [String: Any], mode: String) {
        id = String(describing: value["id"] ?? "")
        title = value["title"] as? String ?? ""
        aliases = value["aliases"] as? [String] ?? []
        poster = value["poster"] as? String ?? ""
        self.mode = mode
        year = value["year"] as? Int
        genres = (value["shikimori"] as? [String: Any])?["genres"] as? [String] ?? value["genres"] as? [String] ?? []
        type = value["type"] as? String ?? ""
    }
}
struct Release: Identifiable {
    let name: String
    let magnet: String
    let seeders: Int
    let label: String
    var id: String { magnet }
    init?(_ row: [String: Any]) {
        guard let name = row["title"] as? String, let magnet = row["magnet"] as? String,
              magnet.range(of: "^magnet:\\?xt=urn:btih:(?:[a-fA-F0-9]{40}|[a-zA-Z2-7]{32})(?:&|$)", options: .regularExpression) != nil else { return nil }
        self.name = name; self.magnet = magnet; seeders = row["seeders"] as? Int ?? 0
        label = ((row["voices"] as? [String] ?? []) + [row["quality_label"] as? String ?? ""]).filter { !$0.isEmpty }.joined(separator: " · ")
    }
}
enum APIError: LocalizedError { case message(String); var errorDescription: String? { if case let .message(value) = self { return value }; return nil } }
final class API {
    func json(_ path: String, method: String = "GET", body: [String: Any]? = nil) async throws -> Any {
        guard path.hasPrefix("/"), let url = URL(string: path, relativeTo: site), url.host == site.host, url.scheme == "https" else { throw APIError.message("Недопустимый адрес") }
        var request = URLRequest(url: url); request.httpMethod = method; request.timeoutInterval = 20
        if let body = body { request.httpBody = try JSONSerialization.data(withJSONObject: body); request.setValue("application/json", forHTTPHeaderField: "Content-Type"); request.setValue(site.absoluteString, forHTTPHeaderField: "Origin") }
        let (bytes, response) = try await URLSession.shared.data(for: request)
        guard bytes.count <= 32_000_000 else { throw APIError.message("Слишком большой ответ сервера") }
        let value = try JSONSerialization.jsonObject(with: bytes)
        guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw APIError.message((value as? [String: Any])?["error"] as? String ?? "Сервис временно недоступен") }
        return value
    }
    func catalog(_ mode: String) async throws -> [TitleItem] {
        let rows = try await json("/api/tv/catalog/" + mode) as? [[String: Any]] ?? []
        return rows.map { TitleItem($0, mode: mode) }
    }
}
@MainActor final class SessionModel: ObservableObject {
    let api = API()
    @Published var user: [String: Any]?
    @Published var library: [String: Any] = [:]
    @Published var message = ""
    func refresh() async {
        do { let result = try await api.json("/api/auth/me") as? [String: Any] ?? [:]; user = result["user"] as? [String: Any]; library = result["library"] as? [String: Any] ?? [:] } catch { message = error.localizedDescription }
    }
    func save(_ title: TitleItem, season: Int? = nil, episode: Int? = nil, complete: Bool = false) async {
        guard let userID = user?["id"] else { message = "Войди, чтобы сохранять просмотренное"; return }
        let base = library[title.id] as? [String: Any] ?? [:]; var next = base
        if let season = season, let episode = episode {
            let key = "\(season):\(episode)"; var seen = next["watchedEpisodes"] as? [String] ?? []
            if seen.contains(key) { if !complete { seen.removeAll { $0 == key } } } else { seen.append(key) }
            let legacy = next["legacyEpisodes"] as? Int ?? max(0, (next["episodes"] as? Int ?? 0) - (base["watchedEpisodes"] as? [String] ?? []).count)
            next["watchedEpisodes"] = seen; next["legacyEpisodes"] = legacy; next["episodes"] = legacy + seen.count
        } else { next["saved"] = !(base["saved"] as? Bool ?? false) }
        do { _ = try await api.json("/api/me/library", method: "PUT", body: ["id": title.id, "userId": userID, "baseEntry": base, "entry": next]); await refresh() } catch { message = error.localizedDescription }
    }
}

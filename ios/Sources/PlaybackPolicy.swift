import Foundation
enum PlaybackPolicy {
    static func normalize(_ value: String) -> String { value.lowercased().replacingOccurrences(of: "[^\\p{L}\\p{N}]+", with: " ", options: .regularExpression).trimmingCharacters(in: .whitespaces) }
    static func matches(_ name: String, _ title: TitleItem) -> Bool {
        let heading = name.replacingOccurrences(of: "^(?:\\s*\\[[^]]+\\]\\s*)+", with: "", options: .regularExpression).replacingOccurrences(of: "_", with: " ").components(separatedBy: CharacterSet(charactersIn: "[(")).first ?? name
        let metadata = "(?i)(?:\\b(?:seasons?|episodes?|complete|batch|s\\d{1,2}(?:e\\d{1,3})?|(?:19|20)\\d{2}|web[ ._-]?(?:dl|rip)|dvdrip|1080p?|720p?)\\b|сезон|серии)"
        return heading.components(separatedBy: CharacterSet(charactersIn: "/|")).contains { field in
            let clean = normalize(field.range(of: metadata, options: .regularExpression).map { String(field[..<$0.lowerBound]) } ?? field)
            return ([title.title] + title.aliases).contains { $0.count >= 3 && normalize($0) == clean }
        }
    }
    static func file(_ files: [[String: Any]], title: TitleItem, season: Int?, episode: Int?) -> Int? {
        for row in files.sorted(by: { ($0["length"] as? Int64 ?? 0) > ($1["length"] as? Int64 ?? 0) }) {
            guard let id = row["id"] as? Int, id > 0, id <= 10000, let path = row["path"] as? String else { continue }
            let size = row["length"] as? Int64 ?? 0
            guard size >= 10_000_000 && size <= 30_000_000_000 else { continue }
            let parts = path.replacingOccurrences(of: "\\", with: "/").components(separatedBy: "/"); let file = parts.last ?? ""
            guard file.range(of: "(?i)\\.(mkv|mp4|avi|webm|ts|m4v)$", options: .regularExpression) != nil, file.range(of: "(?i)(sample|trailer|тизер|трейлер)", options: .regularExpression) == nil else { continue }
            let head = file.replacingOccurrences(of: "(?i)(?:s\\d+e\\d+|\\b\\d{1,4}\\b|\\[).*", with: "", options: .regularExpression).trimmingCharacters(in: CharacterSet(charactersIn: " ._-"))
            guard matches(file, title) || (head.isEmpty && parts.dropLast().contains { matches($0, title) }) else { continue }
            if let season = season, let episode = episode {
                if let regex = try? NSRegularExpression(pattern: "(?i)s(\\d{1,2})[ ._-]*e(\\d{1,3})"),
                   let match = regex.firstMatch(in: file, range: NSRange(file.startIndex..., in: file)),
                   let sr = Range(match.range(at: 1), in: file), let er = Range(match.range(at: 2), in: file) {
                    guard Int(file[sr]) == season && Int(file[er]) == episode else { continue }
                }
                let explicit = "(?i)s0?\(season)[ ._-]*e0?\(episode)(?![0-9])"
                let otherSeason = "(?i)(?:season[ ._-]*|сезон[ ._-]*)0?\(season)(?![0-9])"
                if file.range(of: explicit, options: .regularExpression) == nil {
                    guard path.range(of: otherSeason, options: .regularExpression) != nil,
                          file.range(of: "(?<![0-9])0?\(episode)(?![0-9])", options: .regularExpression) != nil else { continue }
                }
            }
            return id
        }
        return nil
    }
}

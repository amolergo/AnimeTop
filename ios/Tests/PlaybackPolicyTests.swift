import XCTest
@testable import KawaiiFlex
final class PlaybackPolicyTests: XCTestCase {
    func testExplicitTitleAndSeason() {
        let title = TitleItem(["id":"281885", "title":"Дарья", "aliases":["Daria"]], mode:"mult")
        XCTAssertTrue(PlaybackPolicy.matches("Дарья / Daria / Season 2 (1998)",title))
        XCTAssertFalse(PlaybackPolicy.matches("Другой сериал (2020) Дарья Иванова",title))
        let rows: [[String:Any]] = [["id":1,"path":"Daria/Season_01/s01e02.avi","length":Int64(200000000)],["id":2,"path":"Daria/Season_02/s02e02.avi","length":Int64(200000000)]]
        XCTAssertEqual(PlaybackPolicy.file(rows,title:title,season:2,episode:2),2)
        XCTAssertNil(PlaybackPolicy.file(rows,title:title,season:2,episode:3))
    }
}

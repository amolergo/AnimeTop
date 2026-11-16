import XCTest
final class LaunchTests:XCTestCase {
    func testNativeCatalogAndSearchOnIPhone(){
        let app=XCUIApplication();app.launch()
        XCTAssertTrue(app.navigationBars["KawaiiFlex"].waitForExistence(timeout:30))
        let search=app.searchFields.firstMatch
        if !search.exists {app.swipeDown()}
        XCTAssertTrue(search.waitForExistence(timeout:15));search.tap();search.typeText("Истории монстров")
        let result=app.buttons.containing(.staticText,identifier:"Истории монстров").firstMatch
        XCTAssertTrue(result.waitForExistence(timeout:30))
        let catalogue=XCTAttachment(screenshot:XCUIScreen.main.screenshot());catalogue.name="native-iphone-search";catalogue.lifetime = .keepAlways;add(catalogue)
        result.tap()
        XCTAssertTrue(app.navigationBars["О тайтле"].waitForExistence(timeout:15))
        XCTAssertTrue(app.buttons["Смотреть"].waitForExistence(timeout:15))
        let detail=XCTAttachment(screenshot:XCUIScreen.main.screenshot());detail.name="native-iphone-title";detail.lifetime = .keepAlways;add(detail)
    }
}

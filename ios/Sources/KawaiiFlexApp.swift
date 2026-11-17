import SwiftUI
import WebKit
@main struct KawaiiFlexApp: App {
    @StateObject private var session = SessionModel()
    var body: some Scene { WindowGroup { RootView().environmentObject(session).preferredColorScheme(.dark).tint(Color(red:0.79,green:0.70,blue:0.94)) } }
}
struct WebDestination: Identifiable { let path: String; var id: String { path } }
struct RootView: View {
    @EnvironmentObject var session: SessionModel
    @Environment(\.scenePhase) var scenePhase
    @State private var mode = "anime"
    @State private var catalog: [TitleItem] = []
    @State private var query = ""
    @State private var loading = false
    @State private var selected: TitleItem?
    @State private var web: WebDestination?
    @State private var tab = 0
    @State private var email = ""
    @State private var password = ""
    @State private var pairing: [String:Any]?
    private var filtered: [TitleItem] { catalog.filter { item in
        (query.isEmpty || ([item.title] + item.aliases + item.genres).contains { $0.localizedCaseInsensitiveContains(query) }) &&
        (tab != 1 || (session.library[item.id] as? [String:Any])?["saved"] as? Bool == true)
    } }
    var body: some View {
        TabView(selection:$tab) {
            catalogue.tag(0).tabItem { Label("Каталог",systemImage:"square.grid.2x2") }
            catalogue.tag(1).tabItem { Label("Я смотрю",systemImage:"heart") }
            NavigationStack { VStack(spacing:20) { Image(systemName:"person.2").font(.system(size:50)); Text("Твои люди. Твои истории.").font(.title2.bold()); Button("Друзья, советы и сообщения") { web=WebDestination(path:"/#community") } }.navigationTitle("Друзья") }.tag(2).tabItem { Label("Друзья",systemImage:"person.2") }
            NavigationStack { Form {
                if let user=session.user {
                    Section { Text(user["name"] as? String ?? "Профиль").font(.title2.bold()); Text(user["email"] as? String ?? "") }
                    Button("Профиль, подписка и оформление") { web=WebDestination(path:"/#profile") }
                    Button("Мира и рекомендации") { web=WebDestination(path:"/#catalog") }
                    Button("Выйти",role:.destructive) { Task { do { _=try await session.api.json("/api/auth/logout",method:"POST",body:[:]);await session.refresh() } catch {session.message=error.localizedDescription} } }
                } else {
                    Section("Общий аккаунт с сайтом и ТВ") { TextField("Email",text:$email).textContentType(.username).textInputAutocapitalization(.never).keyboardType(.emailAddress);SecureField("Пароль",text:$password).textContentType(.password);Button("Войти") { Task { do { _=try await session.api.json("/api/auth/login",method:"POST",body:["email":email,"password":password]);password="";await session.refresh() } catch {session.message=error.localizedDescription} } } }
                    Button("Регистрация и другие способы входа") { web=WebDestination(path:"/#profile") }
                    Button("Войти через Telegram") {Task {do {pairing=try await session.api.json("/api/auth/tv/start",method:"POST",body:[:]) as? [String:Any]}catch{session.message=error.localizedDescription}}}
                    if let pairing=pairing,let code=pairing["code"] as? String {
                        Text("Код: \(code)").font(.title2.monospaced()).textSelection(.enabled)
                        if let address=pairing["telegramUrl"] as? String,let url=URL(string:address){Link("Подтвердить аккаунт в Telegram",destination:url)}
                    }
                }
                if !session.message.isEmpty { Text(session.message).foregroundStyle(.secondary) }
            }.navigationTitle("Твой профиль") }.tag(3).tabItem { Label("Профиль",systemImage:"person.crop.circle") }
        }
        .sheet(item:$selected) { item in DetailView(item:item).environmentObject(session) }
        .sheet(item:$web,onDismiss:{ Task { await session.refresh() } }) { destination in AccountWebView(path:destination.path) }
        .task(id:mode) { loading=true;do {catalog=try await session.api.catalog(mode)}catch {session.message=error.localizedDescription};loading=false }
        .task { await session.refresh() }
        .task(id:pairing?["code"] as? String ?? "") {guard let code=pairing?["code"] as? String,let token=pairing?["token"] as? String else{return};for _ in 0..<180 {do {try await Task.sleep(nanoseconds:2_000_000_000);let result=try await session.api.json("/api/auth/tv/finish",method:"POST",body:["code":code,"token":token]) as? [String:Any];if result?["status"] as? String == "approved" {pairing=nil;await session.refresh();return}}catch is CancellationError{return}catch{pairing=nil;session.message="Код истёк. Получи новый код.";return}};pairing=nil}
        .onChange(of:scenePhase) { phase in if phase == .active { Task { await session.refresh() } } }
    }
    private var catalogue: some View { NavigationStack {
        ScrollView {
            VStack(alignment:.leading,spacing:18) {
                Picker("Каталог",selection:$mode) { Text("Аниме").tag("anime");Text("Мультфильмы").tag("mult");Text("Кино").tag("cinema") }.pickerStyle(.segmented)
                Text(tab==1 ? "Твоя коллекция" : "Открой что-то своё").font(.title2.bold())
                if loading { ProgressView().frame(maxWidth:.infinity) }
                LazyVGrid(columns:[GridItem(.adaptive(minimum:140),spacing:14)],spacing:22) { ForEach(filtered) { item in Button {selected=item} label:{PosterView(item:item)}.buttonStyle(.plain) } }
                if filtered.isEmpty && !loading { Text(tab==1 ? "Сохрани первый тайтл — он появится и здесь." : "Ничего не найдено").foregroundStyle(.secondary).frame(maxWidth:.infinity).padding(.vertical,40) }
            }.padding(18)
        }.background(Color(red:0.08,green:0.09,blue:0.15)).navigationTitle("KawaiiFlex").searchable(text:$query,prompt:"Название или жанр")
    } }
}
struct PosterView: View {
    let item: TitleItem
    var body: some View { VStack(alignment:.leading,spacing:8) {
        GeometryReader { geometry in
            AsyncImage(url:URL(string:item.poster)) { image in image.resizable().scaledToFill() } placeholder:{Color.white.opacity(0.06)}
                .frame(width:geometry.size.width,height:geometry.size.height).clipped()
        }.aspectRatio(2.0/3.0,contentMode:.fit).clipShape(RoundedRectangle(cornerRadius:14))
        Text(item.title).font(.subheadline.weight(.semibold)).lineLimit(2).multilineTextAlignment(.leading)
        Text([item.year.map(String.init),item.type].compactMap{$0}.joined(separator:" · ")).font(.caption2).foregroundStyle(.secondary).lineLimit(1)
    } }
}
struct PlayDestination: Identifiable { let item:TitleItem; let season:Int?; let episode:Int?; var id:String {"\(item.id):\(season ?? 0):\(episode ?? 0)"} }
struct DetailView: View {
    let item:TitleItem
    @EnvironmentObject var session:SessionModel
    @Environment(\.dismiss) var dismiss
    @State private var film:[String:Any]=[:]
    @State private var related:[TitleItem]=[]
    @State private var part:TitleItem?
    @State private var play:PlayDestination?
    @State private var web:WebDestination?
    @State private var season=1
    private var movie:Bool {(film["serial"] as? Bool)==false || (item.type.localizedCaseInsensitiveContains("фильм") && !item.type.localizedCaseInsensitiveContains("сериал"))}
    private var seasons:[[String:Any]] {film["seasons"] as? [[String:Any]] ?? []}
    private var episodes:[Int] { let row=seasons.first {($0["number"] as? Int)==season};let list=(row?["episodeList"] ?? row?["episodes"]) as? [[String:Any]];return list?.compactMap {$0["number"] as? Int}.filter {$0>0} ?? Array(1...12) }
    var body:some View { NavigationStack {
        ScrollView { VStack(alignment:.leading,spacing:20) {
            HStack(alignment:.top,spacing:20) { AsyncImage(url:URL(string:item.poster)){image in image.resizable().scaledToFill()}placeholder:{Color.white.opacity(0.06)}.frame(width:120,height:180).clipped().clipShape(RoundedRectangle(cornerRadius:14));VStack(alignment:.leading,spacing:12){Text(item.title).font(.title2.bold());Text([item.year.map(String.init),item.type].compactMap{$0}.joined(separator:" · ")).font(.caption).foregroundStyle(.secondary);Text(item.genres.prefix(5).joined(separator:" · ")).font(.caption).foregroundStyle(.secondary);Button("В коллекцию") {Task {await session.save(item)}}.buttonStyle(.bordered)} }
            Button(movie ? "Смотреть фильм" : "Смотреть") {start(season,1)}.buttonStyle(.borderedProminent).frame(maxWidth:.infinity)
            if let description=film["description"] as? String {Text(description).font(.subheadline).foregroundStyle(.secondary)}
            if !movie {
                Text("Сезоны и серии").font(.headline)
                ScrollView(.horizontal,showsIndicators:false) { HStack {ForEach(seasons.compactMap {$0["number"] as? Int}.isEmpty ? [1] : seasons.compactMap {$0["number"] as? Int},id:\.self){number in Button("Сезон \(number)"){season=number}.buttonStyle(.bordered)}} }
                ForEach(episodes,id:\.self){number in HStack {Button("▶  Серия \(number)"){start(season,number)};Spacer();Button {Task {await session.save(item,season:season,episode:number)}} label:{Image(systemName:watched(number) ? "checkmark.circle.fill" : "circle")}.accessibilityLabel(watched(number) ? "Убрать отметку просмотра" : "Отметить просмотренной")}.padding(13).background(.white.opacity(0.045),in:RoundedRectangle(cornerRadius:12))}
            }
            if related.count>1 {Text("Другие части и сезоны").font(.headline);ScrollView(.horizontal,showsIndicators:false){HStack(alignment:.top,spacing:12){ForEach(related){title in Button {part=title} label:{PosterView(item:title).frame(width:110)}.buttonStyle(.plain)}}}}
            Button("Отзывы, папки и советы друзьям"){web=WebDestination(path:"/?mode=\(item.mode)&open=\(item.id)#catalog")}
        }.padding(20) }.navigationTitle("О тайтле").navigationBarTitleDisplayMode(.inline).toolbar {ToolbarItem(placement:.cancellationAction){Button("Готово"){dismiss()}}}
    }.task {do {film=try await session.api.json("/api/kinopoisk/films/\(item.id)") as? [String:Any] ?? [:]}catch{};do {let result=try await session.api.json("/api/titles/related?id=\(item.id)&mode=\(item.mode)") as? [String:Any];related=(result?["items"] as? [[String:Any]] ?? []).map {TitleItem($0,mode:item.mode)}}catch{} }
    .fullScreenCover(item:$play){destination in PlayerScreen(destination:destination).environmentObject(session)}
    .sheet(item:$part){title in DetailView(item:title).environmentObject(session)}
    .sheet(item:$web,onDismiss:{Task {await session.refresh()}}){AccountWebView(path:$0.path)}
    }
    private func watched(_ episode:Int)->Bool {let entry=session.library[item.id] as? [String:Any];return (entry?["watchedEpisodes"] as? [String] ?? []).contains("\(season):\(episode)")}
    private func start(_ season:Int,_ episode:Int){guard session.user != nil else {session.message="Войди в аккаунт для просмотра";web=WebDestination(path:"/#profile");return};play=PlayDestination(item:item,season:movie ? nil:season,episode:movie ? nil:episode)}
}
struct AccountWebView:UIViewRepresentable {
    let path:String
    func makeCoordinator()->Coordinator {Coordinator()}
    func makeUIView(context:Context)->WKWebView {let view=WKWebView();view.navigationDelegate=context.coordinator;Task {@MainActor in for cookie in HTTPCookieStorage.shared.cookies(for:site) ?? [] {await view.configuration.websiteDataStore.httpCookieStore.setCookie(cookie)};view.load(URLRequest(url:URL(string:path,relativeTo:site)!))};return view}
    func updateUIView(_ uiView:WKWebView,context:Context){}
    class Coordinator:NSObject,WKNavigationDelegate {
        func webView(_ view:WKWebView,didFinish navigation:WKNavigation!){view.configuration.websiteDataStore.httpCookieStore.getAllCookies {cookies in for cookie in cookies where cookie.domain==site.host {HTTPCookieStorage.shared.setCookie(cookie)}}}
        func webView(_ view:WKWebView,decidePolicyFor action:WKNavigationAction,decisionHandler:@escaping(WKNavigationActionPolicy)->Void){guard let url=action.request.url else {decisionHandler(.cancel);return};if action.targetFrame?.isMainFrame != false && url.host != site.host {if ["https","tg"].contains(url.scheme ?? ""){UIApplication.shared.open(url)};decisionHandler(.cancel)}else{decisionHandler(["https","about"].contains(url.scheme ?? "") ? .allow:.cancel)}}
    }
}


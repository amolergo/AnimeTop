import SwiftUI
import Foundation

actor TorrentResolver {
    private let port=18791
    private let network:URLSession = { let config=URLSessionConfiguration.ephemeral;config.httpShouldSetCookies=false;config.timeoutIntervalForRequest=12;config.timeoutIntervalForResource=35;return URLSession(configuration:config) }()
    func start() async throws {
        guard !TorrserverkitIsRunning() else {return}
        let directory=FileManager.default.urls(for:.cachesDirectory,in:.userDomainMask)[0].appendingPathComponent("torrserver",isDirectory:true)
        let error=await Task.detached {TorrserverkitStartServer(18791,directory.path)}.value
        if !error.isEmpty {throw APIError.message("Не запустился встроенный видеодвижок")}
    }
    private func json(_ path:String,body:[String:Any]?=nil) async throws->[String:Any] {
        guard let url=URL(string:"http://127.0.0.1:\(port)"+path),url.host=="127.0.0.1" else {throw APIError.message("Недопустимый поток")}
        var request=URLRequest(url:url)
        if let body=body {request.httpMethod="POST";request.setValue("application/json",forHTTPHeaderField:"Content-Type");request.httpBody=try JSONSerialization.data(withJSONObject:body)}
        let (bytes,response)=try await network.data(for:request)
        guard (response as? HTTPURLResponse)?.statusCode==200,bytes.count<2_000_000 else {throw APIError.message("Раздача не ответила")}
        return try JSONSerialization.jsonObject(with:bytes) as? [String:Any] ?? [:]
    }
    func stream(_ release:Release,destination:PlayDestination) async throws->URL {
        try await start()
        _=try await json("/torrents",body:["action":"add","link":release.magnet,"save_to_db":false])
        let encoded=release.magnet.addingPercentEncoding(withAllowedCharacters:.urlQueryAllowed.subtracting(CharacterSet(charactersIn:"&+=?#")))!
        var status:[String:Any]=[:]
        for _ in 0..<8 {try Task.checkCancellation();status=try await json("/stream?link=\(encoded)&stat=1");if !(status["file_stats"] as? [[String:Any]] ?? []).isEmpty {break};try await Task.sleep(nanoseconds:500_000_000)}
        guard let hash=status["hash"] as? String,hash.range(of:"^[a-fA-F0-9]{40}$",options:.regularExpression) != nil,
              let file=PlaybackPolicy.file(status["file_stats"] as? [[String:Any]] ?? [],title:destination.item,season:destination.season,episode:destination.episode) else {throw APIError.message("В раздаче не найдена нужная серия")}
        return URL(string:"http://127.0.0.1:\(port)/stream?link=\(hash)&index=\(file)&play=1")!
    }
    func close() async { _=await Task.detached {TorrserverkitStopServer()}.value }
}
@MainActor final class PlayerModel:NSObject,ObservableObject,VLCMediaPlayerDelegate {
    let player=VLCMediaPlayer()
    let resolver=TorrentResolver()
    @Published var status="Ищем нужную серию…"
    @Published var releases:[Release]=[]
    @Published var position:Double=0
    @Published var duration:Double=0
    @Published var playing=false
    @Published var audio:[(Int32,String)]=[]
    @Published var subtitles:[(Int32,String)]=[]
    private var failed=Set<String>()
    private var current:Release?
    private var timer:Timer?
    private var anchor=Date()
    private var anchorPosition:Double=0
    private var healthy:Date?
    private var marked=false
    var completed:(()->Void)?
    override init(){super.init();player.delegate=self;timer=Timer.scheduledTimer(withTimeInterval:0.5,repeats:true){[weak self]_ in Task {@MainActor in self?.tick()}}}
    func load(_ destination:PlayDestination,api:API,preferred:Release?=nil) async {
        player.stop();status="Подключаем видео…";healthy=nil;marked=false;position=0
        do {
            _=try await api.json("/api/me/playback-access")
            if releases.isEmpty {
                var found:[Release]=[]
                for name in ([destination.item.title]+destination.item.aliases).prefix(2) {
                    try Task.checkCancellation()
                    let query=name.addingPercentEncoding(withAllowedCharacters:.urlQueryAllowed.subtracting(CharacterSet(charactersIn:"&+=?#")))!
                    let result=try await api.json("/api/tv/torrents?query="+query) as? [String:Any] ?? [:]
                    found += (result["results"] as? [[String:Any]] ?? []).compactMap(Release.init).filter {PlaybackPolicy.matches($0.name,destination.item)}
                }
                var seen=Set<String>();releases=found.filter {seen.insert($0.magnet).inserted}.sorted {$0.seeders>$1.seeders}
            }
            let candidates=([preferred].compactMap{$0}+releases).filter {!failed.contains($0.id)}
            for release in candidates.prefix(5) {
                do {try Task.checkCancellation();let url=try await resolver.stream(release,destination:destination);current=release;anchor=Date();anchorPosition=0;player.media=VLCMedia(url:url);player.play();return}
                catch is CancellationError {return}
                catch {failed.insert(release.id)}
            }
            status="Подходящие источники не отдали видео. Попробуй повторить поиск позже."
        }catch is CancellationError {} catch {status=error.localizedDescription}
    }
    func seek(_ time:Double){let target=max(0,min(duration,time));player.time=VLCTime(int:Int32(target*1000));anchor=Date();anchorPosition=target;healthy=nil}
    func pause(){player.pause();playing=false;UIApplication.shared.isIdleTimerDisabled=false}
    func stop(){pause();player.stop();timer?.invalidate();Task {await resolver.close()}}
    func mediaPlayerStateChanged(_ notification:Notification){playing=player.isPlaying;if player.state == .error {status="Не удалось декодировать источник. Выбери другую озвучку или раздачу."}}
    private func tick(){
        playing=player.isPlaying;position=Double(player.time.intValue)/1000;duration=Double(player.media?.length.intValue ?? 0)/1000
        UIApplication.shared.isIdleTimerDisabled=playing
        if playing && player.hasVideoOut {
            if position-anchorPosition>Date().timeIntervalSince(anchor)*Double(player.rate)*3+5 {pause();status="Источник передаёт некорректные временные метки";return}
            status="";healthy=healthy ?? Date()
            if let healthy=healthy,Date().timeIntervalSince(healthy)>10,duration>60,position>=duration*0.9,!marked {marked=true;completed?()}
        }else if !playing {anchor=Date();anchorPosition=position}
        let ids=player.audioTrackIndexes as? [NSNumber] ?? [];let names=player.audioTrackNames as? [String] ?? []
        audio=zip(ids,names).map {($0.int32Value,$1)}
        let subIDs=player.videoSubTitlesIndexes as? [NSNumber] ?? [];let subNames=player.videoSubTitlesNames as? [String] ?? []
        subtitles=zip(subIDs,subNames).map {($0.int32Value,$1)}
    }
}
struct VideoSurface:UIViewRepresentable {
    let player:VLCMediaPlayer
    func makeUIView(context:Context)->UIView {let view=UIView();view.backgroundColor = .black;player.drawable=view;return view}
    func updateUIView(_ view:UIView,context:Context){player.drawable=view}
}
struct PlayerScreen:View {
    let destination:PlayDestination
    @EnvironmentObject var session:SessionModel
    @Environment(\.dismiss) var dismiss
    @Environment(\.scenePhase) var scenePhase
    @StateObject private var model=PlayerModel()
    @State private var sourceID=""
    @State private var speed:Float=1
    var body:some View { VStack(spacing:14) {
        HStack {Button("‹ Назад"){dismiss()};Spacer();Text(destination.item.title).font(.subheadline).lineLimit(1)}.padding(.horizontal)
        ZStack {VideoSurface(player:model.player);if !model.status.isEmpty {Text(model.status).font(.subheadline).padding(20).background(.ultraThinMaterial,in:RoundedRectangle(cornerRadius:14)).padding(25)}}.aspectRatio(16/9,contentMode:.fit)
        HStack(spacing:30){Button {model.seek(model.position-15)} label:{Label("15 с",systemImage:"gobackward.15")};Button {if model.playing {model.pause()}else{model.player.play()}} label:{Image(systemName:model.playing ? "pause.fill":"play.fill").font(.title)};Button {model.seek(model.position+15)} label:{Label("15 с",systemImage:"goforward.15")}}.padding(.vertical,10)
        Slider(value:$model.position,in:0...max(model.duration,1),onEditingChanged:{editing in if !editing {model.seek(model.position)}}).padding(.horizontal)
        HStack {Text(clock(model.position));Spacer();Text(clock(model.duration))}.font(.caption.monospacedDigit()).padding(.horizontal)
        ScrollView(.horizontal,showsIndicators:false){HStack {
            Menu("Озвучка / качество") {ForEach(model.releases){release in Button(release.label.isEmpty ? release.name:release.label){sourceID=release.id}}}
            Menu("Звук") {ForEach(model.audio,id:\.0){row in Button(row.1){model.player.currentAudioTrackIndex=row.0}}}
            Menu("Субтитры") {Button("Выключены"){model.player.currentVideoSubTitleIndex = -1};ForEach(model.subtitles,id:\.0){row in Button(row.1){model.player.currentVideoSubTitleIndex=row.0}}}
            Menu("\(speed,specifier:"%.2g")×") {ForEach([0.75,1,1.25,1.5,2],id:\.self){rate in Button("\(rate,specifier:"%.2g")×"){speed=Float(rate);model.player.rate=Float(rate)}}}
        }.buttonStyle(.bordered).padding(.horizontal)}
        Spacer(minLength:0)
    }.background(.black).task(id:sourceID){model.completed={if let season=destination.season,let episode=destination.episode {Task {await session.save(destination.item,season:season,episode:episode,complete:true)}}};await model.load(destination,api:session.api,preferred:model.releases.first {$0.id==sourceID})}
    .onChange(of:scenePhase){phase in if phase != .active {model.pause()}}
    .onDisappear {model.stop()}
    }
    private func clock(_ value:Double)->String {let seconds=max(0,Int(value));return String(format:"%d:%02d",seconds/60,seconds%60)}
}


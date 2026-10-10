// Native WKWebView feasibility probe, not a Tauri application or replacement backend.
// Build renderer first. Pass repository path and optional HTTP renderer URL.
import AppKit
import WebKit

@MainActor
final class WebKitProbe: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    let root = URL(fileURLWithPath: CommandLine.arguments.dropFirst().first ?? FileManager.default.currentDirectoryPath)
    var window: NSWindow!
    var view: WKWebView!

    func applicationDidFinishLaunching(_ notification: Notification) {
        do {
            let fixtureRoot = root.appendingPathComponent("third_party/eraser-diagrams/fixtures")
            let paths = try FileManager.default.contentsOfDirectory(atPath: fixtureRoot.appendingPathComponent("corpus").path)
                .filter { $0.hasSuffix(".json") }.sorted()
            var fixtures: [[String: Any]] = []
            for file in paths {
                let doc = try JSONSerialization.jsonObject(with: Data(contentsOf: fixtureRoot.appendingPathComponent("corpus/\(file)")))
                let golden = try JSONSerialization.jsonObject(with: Data(contentsOf: fixtureRoot.appendingPathComponent("__goldens__/corpus/\(file.replacingOccurrences(of: ".json", with: "-darwin.json"))")))
                fixtures.append(["name": file, "doc": doc, "golden": golden])
            }
            var names = Set<String>()
            func collect(_ value: Any) {
                if let object = value as? [String: Any] {
                    for (key, child) in object {
                        if key == "icon", let name = child as? String,
                           name.range(of: "^[a-z0-9][a-z0-9-]*$", options: .regularExpression) != nil { names.insert(name) }
                        collect(child)
                    }
                } else if let array = value as? [Any] { array.forEach(collect) }
            }
            collect(fixtures)
            let cache = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/diagrammer/icon-cache")
            var icons: [String: String] = [:]
            for name in names {
                if let svg = try? String(contentsOf: cache.appendingPathComponent("\(name).svg"), encoding: .utf8) { icons[name] = svg }
            }
            let fixturesJSON = String(data: try JSONSerialization.data(withJSONObject: fixtures), encoding: .utf8)!
            let iconsJSON = String(data: try JSONSerialization.data(withJSONObject: icons), encoding: .utf8)!
            let config = WKWebViewConfiguration()
            let bootstrap = """
            window.__probeFixtures = \(fixturesJSON);
            window.__probeIcons = \(iconsJSON);
            window.__probeErrors = [];
            window.addEventListener('error', e => window.__probeErrors.push(String(e.message)));
            window.addEventListener('unhandledrejection', e => window.__probeErrors.push(String(e.reason)));
            const settings = {provider:'codex',baseUrl:'https://api.openai.com/v1',model:'default',cliPath:'',temperature:0.2,maxRepairs:2,contextSize:16384,hostedIcons:false,theme:'dark',hasKey:false};
            window.api = {
              invoke: async (channel,arg) => {
                if(channel==='settings:get') return settings;
                if(channel==='settings:set') return Object.assign(settings,arg);
                if(channel==='llm:models'||channel==='llm:harnesses') return [];
                if(channel==='llm:chat'||channel==='project:scan') throw Error('Native backend is not implemented in this feasibility probe.');
                return null;
              }, on:()=>()=>{}, exportReady:()=>{}
            };
            const originalFetch = window.fetch.bind(window);
            window.fetch = (input, options) => {
              if(String(input).startsWith('icons://')) {
                const name = new URL(String(input)).pathname.replace(/^\\//,'').replace(/\\.svg$/,'');
                const svg = window.__probeIcons[name];
                return Promise.resolve(new Response(svg ?? 'not found',{status:svg?200:404,headers:{'content-type':'image/svg+xml'}}));
              }
              return originalFetch(input,options);
            };
            """
            config.userContentController.addUserScript(WKUserScript(source: bootstrap, injectionTime: .atDocumentStart, forMainFrameOnly: true))
            view = WKWebView(frame: NSRect(x: 0, y: 0, width: 1440, height: 900), configuration: config)
            view.navigationDelegate = self
            window = NSWindow(contentRect: view.frame, styleMask: [.titled, .closable, .resizable], backing: .buffered, defer: false)
            window.title = "Chalkline — native WebKit compatibility check"
            window.contentView = view
            window.makeKeyAndOrderFront(nil)
            let page = CommandLine.arguments.count > 2
                ? URL(string: CommandLine.arguments[2])!
                : root.appendingPathComponent("out/renderer/index.html")
            var url = URLComponents(url: page, resolvingAgainstBaseURL: false)!
            url.query = "test=1"
            if page.isFileURL {
                view.loadFileURL(url.url!, allowingReadAccessTo: root.appendingPathComponent("out/renderer"))
            } else {
                view.load(URLRequest(url: url.url!))
            }
            DispatchQueue.main.asyncAfter(deadline: .now() + 90) { self.fail("Timed out waiting for native WebKit renderer.") }
        } catch { fail(error.localizedDescription) }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail(error.localizedDescription) }
    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) { fail(error.localizedDescription) }
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        Task { @MainActor in
          do {
            let value = try await webView.callAsyncJavaScript("""
        const until = Date.now()+30000;
        while(!window.__dg && Date.now()<until) await new Promise(r=>setTimeout(r,25));
        if(!window.__dg) throw Error('React renderer did not initialize: '+window.__probeErrors.join('; '));
        const failures=[]; let valid=0, matched=0, warnings=0;
        for(const fixture of window.__probeFixtures) {
          const r=await window.__dg.render(fixture.doc);
          if(!r.ok) {failures.push({file:fixture.name,errors:r.errors.slice(0,3)});continue;}
          valid++; warnings+=r.warnings.length;
          const differences=[];
          for(const box of fixture.golden.entities) {
            const actual=r.boxes[box.id];
            if(!actual) differences.push(box.id+': missing');
            else for(const key of ['x','y','width','height'])
              if(Math.abs(actual[key]-box[key])>2) differences.push(box.id+'.'+key+': '+actual[key]+' vs '+box[key]);
          }
          if(differences.length) failures.push({file:fixture.name,differences:differences.slice(0,4)});else matched++;
        }
        const serialized=window.__dg.serialize();
        return JSON.stringify({engine:'native WKWebView',userAgent:navigator.userAgent,reactInitialized:true,
          cssScope:'CSSScopeRule' in window,fixtures:window.__probeFixtures.length,valid,goldenMatchesWithin2px:matched,
          cachedIcons:Object.keys(window.__probeIcons).length,iconWarnings:warnings,serializedSceneChars:serialized.scene.length,
          errors:window.__probeErrors,failures:failures.slice(0,12),backend:'stubbed; no generation, secrets or file dialogs'});
        """, arguments: [:], in: nil, contentWorld: .page)
                guard let report = value as? String else { self.fail("No JavaScript report."); return }
                print(report)
                exit(0)
          } catch {
            let details = (error as NSError).userInfo
            self.fail("\(error.localizedDescription): \(details["WKJavaScriptExceptionMessage"] ?? "no JavaScript details")")
          }
        }
    }
    func fail(_ reason: String) { print("Native WebKit check failed: \(reason)"); exit(1) }
}

MainActor.assumeIsolated {
    let application = NSApplication.shared
    let probe = WebKitProbe()
    application.setActivationPolicy(.accessory)
    application.delegate = probe
    application.run()
}

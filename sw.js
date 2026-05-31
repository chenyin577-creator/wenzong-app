/* 文综冲刺 App · Service Worker
   作用：首次联网打开后，把整套 App（壳 + 题库）缓存下来，之后断网/弱网也能正常刷题。
   更新策略：HTML 网络优先（联网即拿最新），带版本号的静态资源缓存优先（同版本不变）。
   每次发版：同时 bump 本文件 CACHE 版本号 + index.html 里的 ?v= 资源版本号。 */
var CACHE = "wenzong-cache-20260531e";
var ASSETS = [
  "./",
  "./index.html",
  "./styles.css?v=20260531e",
  "./app.js?v=20260531e",
  "./questions.js?v=20260531e",
  "./manifest.webmanifest"
];

self.addEventListener("install", function (e) {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      // 单个资源失败不应整体 install 失败（容错）
      return Promise.all(ASSETS.map(function (u) {
        return c.add(u).catch(function () {});
      }));
    })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.map(function (k) {
        if (k !== CACHE) return caches.delete(k); // 清掉旧版本缓存
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // 不拦截豆包等外链

  var accept = req.headers.get("accept") || "";
  var isHTML = req.mode === "navigate" || accept.indexOf("text/html") >= 0;

  if (isHTML) {
    // HTML：网络优先，断网回退到缓存的首页
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      }).catch(function () {
        return caches.match(req).then(function (m) {
          return m || caches.match("./index.html") || caches.match("./");
        });
      })
    );
    return;
  }

  // 其它资源：缓存优先，未命中再联网并回填缓存
  e.respondWith(
    caches.match(req).then(function (m) {
      if (m) return m;
      return fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
        return res;
      });
    })
  );
});

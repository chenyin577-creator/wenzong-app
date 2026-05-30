/* ================= 文综冲刺 App 主逻辑 =================
   纯原生 JS，无框架/无构建。题库来自 questions.js 的 window.QUESTIONS / window.SUBJECTIVE。
   架构：单页多视图，render*() 生成 HTML 字符串写入 #screen，事件用委托(data-action)。 */
(function () {
  "use strict";

  /* ---------------- 常量 ---------------- */
  var EXAM_DATE = new Date(2026, 5, 20);          // 2026-06-20 中考
  var INTERVAL = { 1: 0, 2: 1, 3: 2, 4: 4, 5: 7 };  // 盒→间隔(天)，为冲刺压缩
  var KEY = "wenzong_v1";
  var SUBJECTS = ["中国史", "道法", "地理", "世界史", "时政"];
  var WEAK_WEIGHT = { "中国史": 5, "道法": 4, "地理": 3, "世界史": 2, "时政": 1 }; // 越大越优先补
  var DEFAULT_GOAL = 15;
  var BEASTS = ["知识怪", "审题怪", "材料怪", "表达怪"];
  var BEAST_EMOJI = { "知识怪": "📚", "审题怪": "🔍", "材料怪": "📄", "表达怪": "✍️" };

  var Q = (window.QUESTIONS || []).filter(function (q) { return q && q.id && q.type; });
  var SUBJ = window.SUBJECTIVE || [];
  var QBYID = {}; Q.forEach(function (q) { QBYID[q.id] = q; });

  /* ---------------- 日期工具 ---------------- */
  function pad(n) { return n < 10 ? "0" + n : "" + n; }
  function toStr(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function todayStr() { return toStr(new Date()); }
  function addDays(str, n) { var d = new Date(str + "T00:00:00"); d.setDate(d.getDate() + n); return toStr(d); }
  function daysToExam() {
    var t = new Date(); t.setHours(0, 0, 0, 0);
    return Math.max(0, Math.round((EXAM_DATE - t) / 86400000));
  }
  function lte(a, b) { return a <= b; } // YYYY-MM-DD 字符串可直接比较

  /* ---------------- 存储（localStorage + 降级内存） ---------------- */
  var MEM = null, DEGRADED = false;
  function freshState() {
    return {
      byQid: {},
      subjective: {},
      stats: {
        dailyGoal: DEFAULT_GOAL, streakDays: 0, lastStudyDate: null,
        bestCombo: 0, totalAnswered: 0, history: [], badges: []
      }
    };
  }
  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return freshState();
      var s = JSON.parse(raw);
      if (!s.byQid) s.byQid = {};
      if (!s.subjective) s.subjective = {};
      if (!s.stats) s.stats = freshState().stats;
      if (!s.stats.history) s.stats.history = [];
      if (!s.stats.badges) s.stats.badges = [];
      if (!s.stats.dailyGoal) s.stats.dailyGoal = DEFAULT_GOAL;
      return s;
    } catch (e) { DEGRADED = true; return MEM || (MEM = freshState()); }
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(STATE)); }
    catch (e) { DEGRADED = true; MEM = STATE; toast("⚠️ 无法保存进度（隐私模式？），本次记录仅存内存"); }
  }
  var STATE = load();

  /* ---------------- 卡片/进度 ---------------- */
  function card(qid) {
    var c = STATE.byQid[qid];
    if (!c) { c = { box: 1, lastSeen: null, nextDue: todayStr(), timesSeen: 0, timesCorrect: 0, streak: 0 }; STATE.byQid[qid] = c; }
    return c;
  }
  function isDisputed(q) { return q && q.disputed === true; }

  function grade(qid, correct) {
    var q = QBYID[qid]; if (!q) return null;
    var c = card(qid);
    var before = { seen: c.timesSeen, correct: c.timesCorrect, box: c.box };
    c.timesSeen++;
    if (isDisputed(q)) { c.lastSeen = todayStr(); save(); return { before: before, disputed: true }; }
    if (correct) {
      c.timesCorrect++; c.streak++;
      c.box = Math.min(c.box + 1, 5);
    } else {
      c.streak = 0; c.box = 1;
    }
    c.lastSeen = todayStr();
    c.nextDue = addDays(todayStr(), INTERVAL[c.box]);
    save();
    return { before: before, disputed: false };
  }

  /* ---------------- 抽题逻辑 ---------------- */
  function shuffle(a) { for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var t = a[i]; a[i] = a[j]; a[j] = t; } return a; }

  function dueList() {
    var t = todayStr(), out = [];
    Q.forEach(function (q) {
      var c = STATE.byQid[q.id];
      if (c && c.timesSeen > 0 && lte(c.nextDue, t)) out.push(q.id);
    });
    out.sort(function (a, b) { return (STATE.byQid[a].box) - (STATE.byQid[b].box); });
    return out;
  }
  function unseenWeighted() {
    var pool = Q.filter(function (q) { var c = STATE.byQid[q.id]; return !c || c.timesSeen === 0; });
    // 弱区加权：复制若干份后打乱，再去重保序
    var weighted = [];
    pool.forEach(function (q) { var w = WEAK_WEIGHT[q.subject] || 1; for (var i = 0; i < w; i++) weighted.push(q.id); });
    shuffle(weighted);
    var seen = {}, out = [];
    weighted.forEach(function (id) { if (!seen[id]) { seen[id] = 1; out.push(id); } });
    return out;
  }
  function lowestBoxOld(exclude) {
    var ex = {}; (exclude || []).forEach(function (id) { ex[id] = 1; });
    var arr = Q.filter(function (q) { var c = STATE.byQid[q.id]; return c && c.timesSeen > 0 && !ex[q.id]; })
      .map(function (q) { return q.id; });
    arr.sort(function (a, b) { return STATE.byQid[a].box - STATE.byQid[b].box; });
    return arr;
  }
  function buildDaily(goal) {
    var queue = dueList();
    if (queue.length < goal) {
      var add = unseenWeighted();
      for (var i = 0; i < add.length && queue.length < goal; i++) queue.push(add[i]);
    }
    if (queue.length < goal) {
      var old = lowestBoxOld(queue);
      for (var j = 0; j < old.length && queue.length < goal; j++) queue.push(old[j]);
    }
    return queue.slice(0, goal);
  }
  function bySubject(subj) { return shuffle(Q.filter(function (q) { return q.subject === subj; }).map(function (q) { return q.id; })); }
  function byTrap(trap) { return shuffle(Q.filter(function (q) { return q.trap === trap; }).map(function (q) { return q.id; })); }
  // 错题怪兽 = 至少错过一次且尚未掌握(box<4)的题；只做对、还没巩固的"新题"不算错题
  function isWrongish(c) { return c && c.timesSeen > 0 && c.timesCorrect < c.timesSeen && c.box < 4; }
  function beastQids(beast) {
    return Q.filter(function (q) { return isWrongish(STATE.byQid[q.id]) && q.beast === beast; }).map(function (q) { return q.id; });
  }
  function allWrongish() {
    return Q.filter(function (q) { return isWrongish(STATE.byQid[q.id]); }).map(function (q) { return q.id; });
  }

  /* ---------------- 掌握度 ---------------- */
  function masteryOf(subj) {
    var list = Q.filter(function (q) { return q.subject === subj && !isDisputed(q); });
    if (!list.length) return { pct: 0, total: 0, mastered: 0 };
    var m = 0;
    list.forEach(function (q) { var c = STATE.byQid[q.id]; if (c && c.box >= 4) m++; });
    return { pct: Math.round(m / list.length * 100), total: list.length, mastered: m };
  }
  function answeredToday() {
    var h = STATE.stats.history, t = todayStr();
    for (var i = h.length - 1; i >= 0; i--) if (h[i].date === t) return h[i];
    return null;
  }

  /* ---------------- 会话 ---------------- */
  var SESSION = null;
  function startSession(queue, mode, title) {
    if (!queue.length) { toast("这个范围暂时没有题可练 🎉"); return; }
    SESSION = {
      queue: queue.slice(), idx: 0, mode: mode, title: title || "练习",
      answered: 0, correct: 0, combo: 0, bestCombo: 0,
      wrongIds: [], reviewQueue: [], inReview: false,
      newMastered: 0, revived: 0, selected: null, locked: false
    };
    renderQuiz();
  }

  /* ---------------- 文案 ---------------- */
  function comboText(n) {
    if (n === 3) return "连对 3 题，手感来了 🔥";
    if (n === 5) return "连对 5 题！稳住 🔥";
    if (n === 8) return "连对 8 题，太强了 💪";
    if (n === 12) return "连对 12 题，神了 🔥🔥";
    if (n > 12 && n % 5 === 0) return "连对 " + n + " 题，无敌 ✨";
    return null;
  }
  function wrongText(q, prevSeen) {
    if (q.trap) {
      var tipMap = {
        "说法太绝对": "经典『绝对化』坑——看到“一定/全部/只要…就/都”先警惕。",
        "主体错位": "看清『谁做的/谁负责』，主体一换说法就错。",
        "材料未体现": "材料里没说的别脑补，答案要『材料能找到』。",
        "因果倒置": "理清『谁导致谁』，因果别反。",
        "时间线混淆": "把朝代/事件先后排一排，时代别错位。",
        "地理判读错": "回到图：纬度定南北、经度定东西、等高线/气候图按规则读。",
        "偷换概念": "盯住关键词，概念被悄悄换掉就错。",
        "张冠李戴": "人物/事件/地点别张冠李戴，记准对应关系。",
        "原理误用": "选对应的原理/法条，别套错框。"
      };
      return "🪤 这是『" + q.trap + "』。" + (tipMap[q.trap] || "记住套路就赢了。");
    }
    if (prevSeen > 0) return "上次也在这栽过，没事——错题会再来找你，这次把『为什么』读一遍。";
    return "没关系，错题会再来。先把下面的解析读懂，记住知识点。";
  }

  /* ================= 渲染 ================= */
  var screen = document.getElementById("screen");
  function setScreen(html) { screen.innerHTML = html; window.scrollTo(0, 0); }
  function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

  /* ---- 首页 ---- */
  function renderHome() {
    SESSION = null;
    var goal = STATE.stats.dailyGoal, at = answeredToday(), done = at ? at.answered : 0;
    var pct = Math.min(100, Math.round(done / goal * 100));
    var dleft = daysToExam();
    var bars = SUBJECTS.map(function (s) {
      var m = masteryOf(s), weak = WEAK_WEIGHT[s] >= 4;
      return '<div class="subj' + (weak ? ' weak' : '') + '">' +
        '<div class="top"><span>' + s + (weak ? ' <span class="muted tiny">弱区</span>' : '') + '</span><b>' + m.pct + '%</b></div>' +
        '<div class="bar"><i style="width:' + m.pct + '%"></i></div></div>';
    }).join("");

    var wrongN = allWrongish().length;
    var encourage = dleft > 0
      ? "离中考还有 <b>" + dleft + "</b> 天，今天搞定 " + goal + " 题，下限就稳一点。"
      : "今天就是中考——把速记和错题过一遍，沉住气！";

    setScreen(
      '<div class="hero">' +
        '<div><h1 style="font-size:22px;margin:0">文综冲刺 · 客观题</h1>' +
        '<div class="countdown">' + encourage + '</div></div>' +
        '<div class="streak">🔥<span class="n">' + (STATE.stats.streakDays || 0) + '</span> 天</div>' +
      '</div>' +
      '<div class="card"><div class="ring-wrap">' +
        '<div class="ring" style="--p:' + pct + '"><div class="lbl"><b>' + done + '</b><span>/' + goal + ' 题</span></div></div>' +
        '<div class="grow"><div style="font-weight:700;font-size:17px;margin-bottom:4px">今日目标</div>' +
        '<div class="muted tiny">完成 ' + done + '/' + goal + ' 题' + (pct >= 100 ? ' ✅ 已达标，今天赢了！' : '') + '</div>' +
        '<button class="btn primary big" style="margin-top:12px" data-action="daily">▶ 开始今日复习</button></div>' +
      '</div></div>' +
      '<div class="card"><h3 style="font-size:16px">各学科掌握度 <span class="muted tiny">（box≥4 的题占比）</span></h3>' + bars + '</div>' +
      '<div class="grid">' +
        tile("subject", "🎯", "专项弱区", "按学科集中刷") +
        tile("trap", "🪤", "陷阱专训", "练审题“找茬”") +
        tile("beasts", "👾", "错题怪兽", wrongN ? (wrongN + " 道待消灭") : "暂无错题") +
        tile("subjective", "✍️", "综合题自评", "采分点对照") +
        tile("export", "🖨️", "导出模拟卷", "组卷打印 PDF") +
        tile("settings", "⚙️", "设置目标", "每日 " + goal + " 题") +
      '</div>' +
      (DEGRADED ? '<div class="card tiny" style="border-color:#7a2f2f">⚠️ 当前无法持久保存进度（可能是隐私模式或禁用了存储），记录仅在本次有效。</div>' : '')
    );
  }
  function tile(action, ic, t, d) {
    return '<button class="tile" data-action="' + action + '"><div class="ic">' + ic + '</div><div class="t">' + t + '</div><div class="d">' + d + '</div></button>';
  }

  /* ---- 刷题卡 ---- */
  function renderQuiz() {
    var s = SESSION; if (!s) { renderHome(); return; }
    if (s.idx >= s.queue.length) {
      if (s.reviewQueue.length && !s.inReview) {  // 当天二刷错题
        s.inReview = true; s.queue = s.reviewQueue.slice(); s.reviewQueue = []; s.idx = 0;
        toast("错题再来一遍，趁热打铁 🔁");
      } else { return renderResult(); }
    }
    var q = QBYID[s.queue[s.idx]];
    s.selected = (q.type === "multi") ? [] : null;
    s.locked = false;
    var total = s.queue.length, pos = s.idx + 1;

    var meta = '<div class="qmeta">' +
      '<span class="chip subj">' + esc(q.subject) + '</span>' +
      '<span class="chip">' + ({ judge: "判断", single: "单选", multi: "多选" }[q.type] || q.type) + '</span>' +
      (s.inReview ? '<span class="chip">🔁 错题二刷</span>' : '') +
      '<span class="chip">' + esc(s.title) + ' ' + pos + '/' + total + '</span>' +
      (isDisputed(q) ? '<span class="chip" style="color:#fca5a5">争议·不计分</span>' : '') +
      '</div>';

    var body;
    if (q.type === "judge") {
      body = '<div class="judge-row">' +
        '<button class="opt tf" data-opt="T">✔ 正确 (T)</button>' +
        '<button class="opt tf" data-opt="F">✘ 错误 (F)</button></div>';
    } else {
      var letters = "ABCDEFG";
      body = '<div class="opts">' + q.options.map(function (o, i) {
        var L = letters[i];
        return '<button class="opt" data-opt="' + L + '"><span class="key">' + L + '</span><span>' + esc(o) + '</span></button>';
      }).join("") + '</div>' +
        (q.type === "multi" ? '<button class="btn primary" style="margin-top:14px;width:100%" data-action="submitMulti" disabled>提交答案</button>' : '');
    }

    setScreen(
      '<button class="back" data-action="quitSession">← 退出</button>' +
      '<div class="progressline"><i style="width:' + Math.round(pos / total * 100) + '%"></i></div>' +
      meta +
      '<div class="card"><div class="stem">' + esc(q.stem) +
      (q.type === "multi" ? '<div class="sub">（组合多选，可多选后提交）</div>' : '') +
      '</div>' + body +
      '<div id="fb"></div></div>'
    );
  }

  function arrEq(a, b) { if (a.length !== b.length) return false; var x = a.slice().sort(), y = b.slice().sort(); for (var i = 0; i < x.length; i++) if (x[i] !== y[i]) return false; return true; }

  function chooseOption(letter, btn) {
    var s = SESSION; if (!s || s.locked) return;
    var q = QBYID[s.queue[s.idx]];
    if (q.type === "multi") {
      s.selected = s.selected || [];
      var i = s.selected.indexOf(letter);
      if (i >= 0) { s.selected.splice(i, 1); btn.classList.remove("chosen"); }
      else { s.selected.push(letter); btn.classList.add("chosen"); }
      var submit = screen.querySelector('[data-action="submitMulti"]');
      if (submit) submit.disabled = s.selected.length === 0;
      return;
    }
    lockAndGrade(letter);
  }

  function lockAndGrade(answerGiven) {
    var s = SESSION; if (!s || s.locked) return;
    s.locked = true;
    var q = QBYID[s.queue[s.idx]];
    var correct;
    if (q.type === "judge") correct = (answerGiven === q.answer);
    else if (q.type === "multi") correct = Array.isArray(q.answer) && arrEq(answerGiven, q.answer);
    else correct = (answerGiven === q.answer);

    var info = grade(q.id, correct);
    var disputed = info && info.disputed;

    // 标记选项态
    var opts = screen.querySelectorAll(".opt");
    var correctSet = q.type === "multi" ? q.answer : [q.answer];
    var givenSet = q.type === "multi" ? answerGiven : [answerGiven];
    opts.forEach(function (el) {
      var v = el.getAttribute("data-opt");
      el.disabled = true;
      var isCorrect = correctSet.indexOf(v) >= 0;
      var isGiven = givenSet.indexOf(v) >= 0;
      if (isCorrect) el.classList.add("correct");
      if (isGiven && !isCorrect) el.classList.add("wrong");
      if (!isCorrect && !isGiven) el.classList.add("dim");
      if (correct && isGiven) el.classList.add("pulse");
    });
    var submit = screen.querySelector('[data-action="submitMulti"]'); if (submit) submit.remove();

    // 统计（争议题不计分）
    if (!disputed) {
      s.answered++; if (correct) s.correct++;
      if (correct) { s.combo++; if (s.combo > s.bestCombo) s.bestCombo = s.combo; }
      else { s.combo = 0; }
      if (!correct) s.reviewQueue.push(q.id);
      // 复活/新掌握
      if (info.before.seen > 0 && info.before.correct === 0 && correct) s.revived++;
      if (info.before.box < 4 && card(q.id).box >= 4) s.newMastered++;
      // combo 弹幕
      var ct = comboText(s.combo); if (ct) flashCombo(ct);
      bumpDaily(); maybeBadges();
    }

    // 反馈区
    var ansLabel = q.type === "judge" ? (q.answer === "T" ? "正确(T)" : "错误(F)")
      : (q.type === "multi" ? q.answer.join("") : q.answer);
    var improved = (info.before.seen > 0 && info.before.correct === 0 && correct);
    var head = disputed ? "ℹ️ 争议题（不计分）" : (correct ? (improved ? "✅ 进步啦！这题你之前错过" : "✅ 答对了") : "❌ 再看一眼");
    var badges = "";
    if (q.trap) badges += '<span class="badge trap">🪤 ' + esc(q.trap) + '</span>';
    if (q.beast) badges += '<span class="badge beast">' + (BEAST_EMOJI[q.beast] || "") + ' ' + esc(q.beast) + '</span>';
    var cc = card(q.id);
    badges += '<span class="badge seen">已做对 ' + cc.timesCorrect + '/' + cc.timesSeen + ' 次</span>';

    var extraLine = "";
    if (disputed) extraLine = '<div class="why muted">此题有争议，以老师讲评为准，不计入分数与掌握度。</div>';
    else if (!correct) extraLine = '<div class="why" style="margin-bottom:8px">' + esc(wrongText(q, info.before.seen)) + '</div>';

    var fb = document.getElementById("fb");
    fb.innerHTML =
      '<div class="feedback ' + (disputed ? '' : (correct ? 'ok' : 'bad')) + '">' +
        '<div class="head">' + head + (correct ? '' : '<span class="muted tiny">正确答案：' + esc(ansLabel) + '</span>') + '</div>' +
        '<div class="badges">' + badges + '</div>' +
        extraLine +
        '<div class="why"><b>解析：</b>' + esc(q.why || "") + '</div>' +
        '<div class="cta row">' +
          (!correct && (q.trap || q.beast) ? '<button class="btn sm" data-action="revenge">⚔️ 同类再练3题</button>' : '') +
          '<button class="btn primary grow" data-action="next">下一题 →</button>' +
        '</div>' +
      '</div>';
    document.getElementById("fb").scrollIntoView({ behavior: "smooth", block: "nearest" });
  }

  function nextQuestion() { var s = SESSION; if (!s) return; s.idx++; renderQuiz(); }

  function revenge() {
    var s = SESSION; if (!s) return;
    var q = QBYID[s.queue[s.idx]];
    // 同诱错点优先，其次同失分机制；排除当前题，最多3题，插到当前题之后
    var pool = Q.filter(function (x) {
      if (x.id === q.id) return false;
      return (q.trap && x.trap === q.trap) || (q.beast && x.beast === q.beast);
    }).map(function (x) { return x.id; });
    shuffle(pool);
    var add = pool.slice(0, 3);
    if (!add.length) { toast("题库里暂无同类题，先继续 →"); return; }
    for (var i = 0; i < add.length; i++) s.queue.splice(s.idx + 1 + i, 0, add[i]);
    toast("⚔️ 已插入 " + add.length + " 道同类题，立刻巩固！");
    nextQuestion();
  }

  /* ---- 每日统计 / 打卡 / 徽章 ---- */
  function bumpDaily() {
    var t = todayStr(), st = STATE.stats, rec = answeredToday();
    if (!rec) { rec = { date: t, answered: 0, correct: 0 }; st.history.push(rec); }
    rec.answered++; // 仅记“当日作答数”，正确数在结算累计
    st.totalAnswered = (st.totalAnswered || 0) + 1;
    // 连续打卡
    if (st.lastStudyDate !== t) {
      if (st.lastStudyDate === addDays(t, -1)) st.streakDays = (st.streakDays || 0) + 1;
      else st.streakDays = 1;
      st.lastStudyDate = t;
    }
    save();
  }
  function maybeBadges() {
    var st = STATE.stats, got = [];
    function add(b) { if (st.badges.indexOf(b) < 0) { st.badges.push(b); got.push(b); } }
    if (st.totalAnswered >= 100) add("累计100题");
    if (st.totalAnswered >= 300) add("累计300题");
    if (st.streakDays >= 7) add("7天连打卡");
    SUBJECTS.forEach(function (s) { if (masteryOf(s).pct >= 80) add(s + "过80%"); });
    if (got.length) { save(); toast("🏅 解锁徽章：" + got.join("、")); }
  }

  /* ---- 结算页 ---- */
  function renderResult() {
    var s = SESSION; if (!s) { renderHome(); return; }
    // 把本次正确数写进当日 history.correct
    var rec = answeredToday(); if (rec) { rec.correct = (rec.correct || 0) + s.correct; save(); }
    if (s.bestCombo > (STATE.stats.bestCombo || 0)) { STATE.stats.bestCombo = s.bestCombo; save(); }

    var acc = s.answered ? Math.round(s.correct / s.answered * 100) : 0;
    var goal = STATE.stats.dailyGoal, today = answeredToday(), doneToday = today ? today.answered : 0;
    var hitGoal = doneToday >= goal;
    var praise;
    if (acc >= 90) praise = "稳得一批！这状态考场上也要有 💪";
    else if (acc >= 70) praise = "不错，错的几道记进脑子，明天它们还会来找你。";
    else praise = "今天踩了不少坑——正常，把解析读懂，错题会复活帮你补牢。";

    setScreen(
      '<div class="result-hero"><div class="muted">本次 ' + esc(s.title) + ' 结算</div>' +
      '<div class="big">' + s.correct + '<span class="slash">/' + s.answered + '</span></div>' +
      '<div class="muted">正确率 ' + acc + '%</div></div>' +
      '<div class="stat-grid">' +
        stat(s.bestCombo, "最高连对") +
        stat(s.newMastered, "新掌握") +
        stat(s.revived, "复活错题") +
        stat(doneToday + "/" + goal, "今日进度") +
      '</div>' +
      '<div class="card center">' + (hitGoal ? '🎉 今日目标达成，打卡 +1！连续 ' + (STATE.stats.streakDays || 0) + ' 天 🔥<br>' : '') +
      '<div style="margin-top:6px">' + praise + '</div></div>' +
      '<button class="btn primary big" data-action="daily">再来一组</button>' +
      '<button class="btn big ghost" style="margin-top:10px" data-action="home">回首页</button>'
    );
  }
  function stat(v, l) { return '<div class="stat"><b>' + v + '</b><span>' + l + '</span></div>'; }

  /* ---- 专项弱区 ---- */
  function renderSubjectPick() {
    SESSION = null;
    var items = SUBJECTS.map(function (s) {
      var m = masteryOf(s), n = m.total;
      return '<button class="beast-card" data-action="subjectGo" data-subj="' + s + '">' +
        '<span class="emoji">' + (WEAK_WEIGHT[s] >= 4 ? "🔴" : "📘") + '</span>' +
        '<span class="info"><b>' + s + '</b><div class="muted tiny">' + n + ' 题 · 掌握 ' + m.pct + '%</div></span>' +
        '<span class="n">' + m.pct + '%</span></button>';
    }).join("");
    setScreen('<button class="back" data-action="home">← 返回</button><h2>专项弱区</h2><p class="muted tiny">挑一个学科集中刷；红点是你的弱区，先啃它。</p>' + items);
  }

  /* ---- 陷阱专训 ---- */
  function renderTrapPick() {
    SESSION = null;
    var traps = {};
    Q.forEach(function (q) { if (q.trap) traps[q.trap] = (traps[q.trap] || 0) + 1; });
    var keys = Object.keys(traps).sort(function (a, b) { return traps[b] - traps[a]; });
    var items = keys.map(function (t) {
      return '<button class="beast-card" data-action="trapGo" data-trap="' + esc(t) + '">' +
        '<span class="emoji">🪤</span><span class="info"><b>' + esc(t) + '</b>' +
        '<div class="muted tiny">练这个套路的“找茬”</div></span><span class="n">' + traps[t] + '</span></button>';
    }).join("");
    setScreen('<button class="back" data-action="home">← 返回</button><h2>陷阱专训</h2><p class="muted tiny">客观题失分高度套路化，集中练一种坑，考场就能秒识破。</p>' + items);
  }

  /* ---- 错题怪兽库 ---- */
  function renderBeasts() {
    SESSION = null;
    var any = false;
    var cards = BEASTS.map(function (b) {
      var ids = beastQids(b); if (ids.length) any = true;
      var dis = ids.length ? "" : " disabled";
      var desc = { "知识怪": "知识点记混/记错", "审题怪": "没看清题干/选项", "材料怪": "脱离材料乱答", "表达怪": "概念术语用错" }[b];
      return '<button class="beast-card" data-action="beastGo" data-beast="' + b + '"' + dis + '>' +
        '<span class="emoji">' + BEAST_EMOJI[b] + '</span>' +
        '<span class="info"><b>' + b + '</b><div class="muted tiny">' + desc + '</div></span>' +
        '<span class="n">' + ids.length + '</span></button>';
    }).join("");
    var total = allWrongish().length;
    setScreen(
      '<button class="back" data-action="home">← 返回</button><h2>错题怪兽库 👾</h2>' +
      '<p class="muted tiny">共 <b>' + total + '</b> 道错题怪兽待消灭。按失分类型重练，做对就升盒、间隔变长。</p>' +
      cards +
      (total ? '<button class="btn primary big" style="margin-top:8px" data-action="beastAll">⚔️ 全部错题一起练</button>' : '<div class="card center muted">暂时没有错题——先去“今日复习”吧。</div>')
    );
  }

  /* ---- 综合题采分自评 ---- */
  function renderSubjectiveList() {
    SESSION = null;
    if (!SUBJ.length) { setScreen('<button class="back" data-action="home">← 返回</button><div class="card">暂无综合题。</div>'); return; }
    var cat = { "地理类": "🗺️", "历史类": "📜", "法治国情类": "⚖️", "时政类": "📰" };
    var items = SUBJ.map(function (q, i) {
      var ev = STATE.subjective[q.id];
      var done = ev ? '<span class="n">' + ev.selfScore + '/' + ev.total + '</span>' : '<span class="muted tiny">未自评</span>';
      return '<button class="beast-card" data-action="subjGo" data-i="' + i + '">' +
        '<span class="emoji">' + (cat[q.category] || "✍️") + '</span>' +
        '<span class="info"><b>' + esc(q.category || q.subject) + '</b><div class="muted tiny">' + esc((q.prompt || "").slice(0, 28)) + '…</div></span>' + done + '</button>';
    }).join("");
    setScreen('<button class="back" data-action="home">← 返回</button><h2>综合题 · 采分自评 ✍️</h2>' +
      '<p class="muted tiny">流程：读题 → 在纸上/脑中分点作答 → 展开采分点逐条对照 → 勾出你答到的点，估出采分率。诚实打分才有用。</p>' + items);
  }
  function renderSubjective(i) {
    var q = SUBJ[i]; if (!q) { renderSubjectiveList(); return; }
    SESSION = { subjIdx: i, revealed: false, checked: {} };
    drawSubjective();
  }
  function drawSubjective() {
    var s = SESSION, q = SUBJ[s.subjIdx];
    var terms = (q.terms || []).map(function (t) { return '<span class="term">' + esc(t) + '</span>'; }).join("");
    var body;
    if (!s.revealed) {
      body = '<button class="btn primary big" data-action="reveal">我写完了，展开采分点 ▼</button>';
    } else {
      var checkedN = Object.keys(s.checked).filter(function (k) { return s.checked[k]; }).length;
      var lis = (q.scorePoints || []).map(function (p, idx) {
        var on = s.checked[idx];
        return '<li class="' + (on ? 'got' : '') + '" data-action="toggleSP" data-i="' + idx + '"><span class="box">' + (on ? '✓' : '') + '</span><span>' + esc(p) + '</span></li>';
      }).join("");
      body =
        '<h3 style="margin-top:14px">采分点（勾出你答到的）</h3>' +
        '<ul class="scorelist">' + lis + '</ul>' +
        '<div class="card center"><div class="muted tiny">本题采分率</div><div style="font-size:34px;font-weight:900">' + checkedN + '<span class="slash muted">/' + (q.scorePoints || []).length + '</span></div></div>' +
        '<button class="btn primary big" data-action="saveSubj">保存自评</button>';
    }
    setScreen(
      '<button class="back" data-action="subjective">← 返回综合题</button>' +
      '<div class="qmeta"><span class="chip subj">' + esc(q.category || q.subject) + '</span><span class="chip">综合题·自评</span></div>' +
      '<div class="card"><div class="subj-prompt">' + esc(q.prompt) + '</div></div>' +
      (q.tip ? '<div class="card tiny"><b>答题套路：</b>' + esc(q.tip) + '</div>' : '') +
      (terms ? '<div class="card"><div class="muted tiny" style="margin-bottom:6px">建议用上的术语：</div><div class="termbox">' + terms + '</div></div>' : '') +
      body
    );
  }

  /* ---- 设置 ---- */
  function renderSettings() {
    SESSION = null;
    var g = STATE.stats.dailyGoal;
    setScreen('<button class="back" data-action="home">← 返回</button><h2>设置</h2>' +
      '<div class="card"><div class="field"><label>每日目标题量</label>' +
      '<div class="seg" id="goalSeg">' + [10, 15, 20, 30, 40].map(function (n) { return '<button data-goal="' + n + '" class="' + (n === g ? 'on' : '') + '">' + n + ' 题</button>'; }).join("") + '</div></div>' +
      '<div class="muted tiny">碎片时间建议 10–15 题一轮，随时可停，进度即时保存。</div></div>' +
      '<div class="card"><div class="field"><label>累计数据</label>' +
      '<div class="muted">已作答 ' + (STATE.stats.totalAnswered || 0) + ' 题 · 最高连对 ' + (STATE.stats.bestCombo || 0) + ' · 徽章 ' + (STATE.stats.badges.length || 0) + ' 枚</div></div>' +
      '<button class="btn sm ghost" data-action="resetAsk" style="color:#fca5a5;border-color:#7a2f2f">重置全部进度</button></div>');
  }

  /* ================= 组卷 / 打印 ================= */
  var EXPORT = { scope: "weak", subject: "中国史", nJudge: 8, nSingle: 20, nSubj: 2, answers: true };
  function renderExport() {
    SESSION = null;
    var e = EXPORT;
    function seg(name, opts) {
      return opts.map(function (o) { return '<button data-seg="' + name + '" data-val="' + o.v + '" class="' + (e[name] === o.v ? 'on' : '') + '">' + o.t + '</button>'; }).join("");
    }
    setScreen(
      '<button class="back" data-action="home">← 返回</button><h2>导出纸质模拟卷 🖨️</h2>' +
      '<p class="muted tiny">用你练过的题组一张真卷，打印或“另存为 PDF”，最后几天按真实节奏模拟。</p>' +
      '<div class="card">' +
        '<div class="field"><label>出题范围</label><div class="seg">' + seg("scope", [
          { v: "weak", t: "弱区优先" }, { v: "wrong", t: "我的错题" }, { v: "subject", t: "指定学科" }, { v: "seen", t: "已练过的" }, { v: "all", t: "全部题库" }
        ]) + '</div></div>' +
        '<div class="field" id="subjField"' + (e.scope === "subject" ? '' : ' style="display:none"') + '><label>学科</label>' +
          '<select id="subjSel">' + SUBJECTS.map(function (s) { return '<option' + (e.subject === s ? ' selected' : '') + '>' + s + '</option>'; }).join("") + '</select></div>' +
        '<div class="field"><label>题量</label><div class="num-row">' +
          '<div><span class="muted tiny">判断</span><input type="number" id="nJ" min="0" max="20" value="' + e.nJudge + '"></div>' +
          '<div><span class="muted tiny">选择</span><input type="number" id="nS" min="0" max="40" value="' + e.nSingle + '"></div>' +
          '<div><span class="muted tiny">综合</span><input type="number" id="nZ" min="0" max="4" value="' + e.nSubj + '"></div>' +
        '</div></div>' +
        '<label class="switch"><input type="checkbox" id="ans"' + (e.answers ? ' checked' : '') + '> 附「参考答案与解析」页</label>' +
      '</div>' +
      '<button class="btn primary big" data-action="genPaper">生成试卷 →</button>'
    );
  }

  function pickForPaper() {
    var e = EXPORT, pool;
    if (e.scope === "wrong") pool = allWrongish().map(function (id) { return QBYID[id]; });
    else if (e.scope === "subject") pool = Q.filter(function (q) { return q.subject === e.subject; });
    else if (e.scope === "seen") pool = Q.filter(function (q) { var c = STATE.byQid[q.id]; return c && c.timesSeen > 0; });
    else if (e.scope === "all") pool = Q.slice();
    else { // weak: 按弱区权重排序后取
      pool = Q.slice().sort(function (a, b) { return (WEAK_WEIGHT[b.subject] || 1) - (WEAK_WEIGHT[a.subject] || 1); });
    }
    var judges = shuffle(pool.filter(function (q) { return q.type === "judge"; })).slice(0, e.nJudge);
    var singles = shuffle(pool.filter(function (q) { return q.type !== "judge"; })).slice(0, e.nSingle);
    var subjs = shuffle(SUBJ.slice()).slice(0, e.nSubj);
    return { judges: judges, singles: singles, subjs: subjs };
  }

  function renderPaper() {
    var picked = pickForPaper();
    var e = EXPORT;
    if (!picked.judges.length && !picked.singles.length && !picked.subjs.length) {
      toast("这个范围还没有可用的题，换个范围试试"); return;
    }
    var letters = "ABCDEFG";
    var n = 0;
    var totalObjScore = picked.judges.length * 1 + picked.singles.length * 2;

    var jHtml = picked.judges.map(function (q) {
      n++; return '<div class="pq"><span class="qn">' + n + '.</span> ' + esc(q.stem) + ' <span class="blank">（　　）</span></div>';
    }).join("");

    var sHtml = picked.singles.map(function (q) {
      n++;
      var opts = (q.options || []).map(function (o, i) { return '<div>' + letters[i] + '. ' + esc(o) + '</div>'; }).join("");
      var oneCol = (q.options || []).some(function (o) { return o.length > 14; });
      return '<div class="pq"><span class="qn">' + n + '.</span> ' + esc(q.stem) + ' <span class="blank">（　　）</span>' +
        '<div class="opts-print' + (oneCol ? ' one-col' : '') + '">' + opts + '</div></div>';
    }).join("");

    var zHtml = picked.subjs.map(function (q) {
      n++;
      var lines = '<div class="answer-space"></div>'.repeat(q.scorePoints ? Math.max(4, q.scorePoints.length + 1) : 5);
      return '<div class="pq"><span class="qn">' + n + '.</span>（' + esc(q.category || q.subject) + '）' + esc(q.prompt) + lines + '</div>';
    }).join("");

    // 答案页
    var akHtml = "";
    if (e.answers) {
      var m = 0;
      var jak = picked.judges.map(function (q) { m++; return '<span class="ak-cell">' + m + '.' + q.answer + '</span>'; }).join("　");
      var sak = picked.singles.map(function (q) { m++; var a = Array.isArray(q.answer) ? q.answer.join("") : q.answer; return '<span class="ak-cell">' + m + '.' + a + '</span>'; }).join("　");
      var details = picked.judges.concat(picked.singles).map(function (q, i) {
        return '<div class="ak-item"><span class="a">' + (i + 1) + '. ' + (Array.isArray(q.answer) ? q.answer.join("") : q.answer) + '</span> ' +
          (q.trap ? '<span class="tp">[' + esc(q.trap) + ']</span> ' : '') + esc(q.why || "") + '</div>';
      }).join("");
      var zak = picked.subjs.map(function (q, i) {
        var pts = (q.scorePoints || []).map(function (p, k) { return '<div class="ak-item">（' + (k + 1) + '）' + esc(p) + '</div>'; }).join("");
        return '<div style="margin:8px 0"><b>综合 ' + (picked.judges.length + picked.singles.length + i + 1) + '（' + esc(q.category || q.subject) + '）采分点：</b>' + pts + '</div>';
      }).join("");
      akHtml =
        '<div class="pagebreak"></div>' +
        '<h1>参考答案与解析</h1>' +
        '<div class="sec-title">一、判断题</div><div class="grid2">' + jak + '</div>' +
        '<div class="sec-title">二、选择题</div><div class="grid2">' + sak + '</div>' +
        '<div class="sec-title">逐题解析（含诱错点）</div>' + details +
        (zHtml ? '<div class="sec-title">三、综合题采分要点</div>' + zak : '');
    }

    var dleft = daysToExam();
    var paper =
      '<article class="paper">' +
        '<h1>社会·法治 冲刺模拟卷</h1>' +
        '<div class="sub-head">闭卷 ｜ 客观题 ' + totalObjScore + ' 分' + (zHtml ? ' ＋ 综合题' : '') + ' ｜ 距中考约 ' + dleft + ' 天</div>' +
        '<div class="meta-line"><span>姓名：____________</span><span>日期：____________</span><span>用时：________ 分钟</span><span>得分：________</span></div>' +
        '<div class="notice">说明：判断题对的填 T、错的填 F；选择题选最佳选项填字母；综合题分点作答、踩关键词术语。</div>' +
        (jHtml ? '<div class="sec-title">一、判断题（每题 1 分，共 ' + picked.judges.length + ' 分）</div>' + jHtml : '') +
        (sHtml ? '<div class="sec-title">二、选择题（每题 2 分，共 ' + (picked.singles.length * 2) + ' 分）</div>' + sHtml : '') +
        (zHtml ? '<div class="sec-title">三、综合题（分点作答）</div>' + zHtml : '') +
        akHtml +
      '</article>';

    setScreen(
      '<div class="paper-toolbar no-print">' +
        '<button class="back" data-action="export">← 重新组卷</button>' +
        '<div class="grow"></div>' +
        '<button class="btn sm" data-action="export">⟳ 换一套</button>' +
        '<button class="btn primary sm" data-action="doPrint">🖨️ 打印 / 存 PDF</button>' +
      '</div>' +
      '<div class="muted tiny no-print" style="margin-bottom:10px">共 ' + n + ' 题。点右上「打印 / 存 PDF」，在弹窗里选“另存为 PDF”即可得到纸质卷。' + (e.answers ? '答案在最后一页，可分开打印。' : '') + '</div>' +
      paper
    );
  }

  /* ================= 事件委托 ================= */
  function on(el, ev, fn) { el.addEventListener(ev, fn); }

  on(screen, "click", function (ev) {
    var t = ev.target.closest("[data-action],[data-opt],[data-goal],[data-seg],[data-subj],[data-trap],[data-beast]");
    if (!t) return;

    // 选项作答
    if (t.hasAttribute("data-opt")) { chooseOption(t.getAttribute("data-opt"), t); return; }
    // 设置目标
    if (t.hasAttribute("data-goal")) { STATE.stats.dailyGoal = parseInt(t.getAttribute("data-goal"), 10); save(); renderSettings(); return; }
    // 组卷分段控件
    if (t.hasAttribute("data-seg")) {
      var name = t.getAttribute("data-seg"); EXPORT[name] = t.getAttribute("data-val");
      syncExportInputs(); renderExport(); return;
    }
    if (t.hasAttribute("data-subj")) { /* handled by subjectGo */ }

    var a = t.getAttribute("data-action");
    switch (a) {
      case "home": renderHome(); break;
      case "daily": startSession(buildDaily(STATE.stats.dailyGoal), "daily", "今日复习"); break;
      case "subject": renderSubjectPick(); break;
      case "subjectGo": startSession(bySubject(t.getAttribute("data-subj")), "subject", t.getAttribute("data-subj")); break;
      case "trap": renderTrapPick(); break;
      case "trapGo": startSession(byTrap(t.getAttribute("data-trap")), "trap", t.getAttribute("data-trap")); break;
      case "beasts": renderBeasts(); break;
      case "beastGo": startSession(beastQids(t.getAttribute("data-beast")), "beast", t.getAttribute("data-beast")); break;
      case "beastAll": startSession(allWrongish(), "beast", "全部错题"); break;
      case "next": nextQuestion(); break;
      case "revenge": revenge(); break;
      case "submitMulti": if (SESSION && SESSION.selected && SESSION.selected.length) lockAndGrade(SESSION.selected.slice()); break;
      case "quitSession": if (SESSION && SESSION.answered > 0) renderResult(); else renderHome(); break;
      case "subjective": renderSubjectiveList(); break;
      case "subjGo": renderSubjective(parseInt(t.getAttribute("data-i"), 10)); break;
      case "reveal": SESSION.revealed = true; drawSubjective(); break;
      case "toggleSP": { var i = t.getAttribute("data-i"); SESSION.checked[i] = !SESSION.checked[i]; drawSubjective(); break; }
      case "saveSubj": saveSubjective(); break;
      case "export": readExportInputs(); renderExport(); break;
      case "genPaper": readExportInputs(); renderPaper(); break;
      case "doPrint": window.print(); break;
      case "settings": renderSettings(); break;
      case "resetAsk":
        if (confirm("确定清空全部刷题进度、打卡和徽章？此操作不可撤销。")) {
          STATE = freshState(); save(); toast("已重置"); renderHome();
        }
        break;
    }
  });

  function syncExportInputs() { /* 切换 scope 后由 renderExport 重画，无需额外同步 */ }
  function readExportInputs() {
    var nJ = document.getElementById("nJ"), nS = document.getElementById("nS"), nZ = document.getElementById("nZ"),
      ans = document.getElementById("ans"), sel = document.getElementById("subjSel");
    if (nJ) EXPORT.nJudge = clampInt(nJ.value, 0, 20, 8);
    if (nS) EXPORT.nSingle = clampInt(nS.value, 0, 40, 20);
    if (nZ) EXPORT.nSubj = clampInt(nZ.value, 0, SUBJ.length, 2);
    if (ans) EXPORT.answers = ans.checked;
    if (sel) EXPORT.subject = sel.value;
  }
  function clampInt(v, lo, hi, dft) { var n = parseInt(v, 10); if (isNaN(n)) n = dft; return Math.max(lo, Math.min(hi, n)); }

  function saveSubjective() {
    var s = SESSION, q = SUBJ[s.subjIdx];
    var total = (q.scorePoints || []).length;
    var got = Object.keys(s.checked).filter(function (k) { return s.checked[k]; }).length;
    STATE.subjective[q.id] = { selfScore: got, total: total, date: todayStr() };
    save();
    toast("已记录采分率 " + got + "/" + total + " ✅");
    renderSubjectiveList();
  }

  /* ---- 键盘快捷键 ---- */
  on(document, "keydown", function (e) {
    if (!SESSION || SESSION.subjIdx != null) return;
    var q = SESSION.queue ? QBYID[SESSION.queue[SESSION.idx]] : null; if (!q) return;
    if (SESSION.locked) { if (e.key === " " || e.key === "Enter" || e.key === "ArrowRight") { e.preventDefault(); nextQuestion(); } return; }
    var k = e.key.toUpperCase();
    if (q.type === "judge") {
      if (k === "T" || e.key === "ArrowLeft" || k === "1") { e.preventDefault(); pressOpt("T"); }
      else if (k === "F" || e.key === "ArrowRight" || k === "2") { e.preventDefault(); pressOpt("F"); }
    } else if ("ABCDEFG".indexOf(k) >= 0 && k.charCodeAt(0) - 65 < (q.options || []).length) {
      e.preventDefault(); pressOpt(k);
    } else if ((e.key === " " || e.key === "Enter") && q.type === "multi" && SESSION.selected && SESSION.selected.length) {
      e.preventDefault(); lockAndGrade(SESSION.selected.slice());
    }
  });
  function pressOpt(L) { var el = screen.querySelector('[data-opt="' + L + '"]'); if (el) chooseOption(L, el); }

  /* ---- toast / combo ---- */
  var toastEl = document.getElementById("toast"), toastT;
  function toast(msg) { toastEl.textContent = msg; toastEl.classList.add("show"); clearTimeout(toastT); toastT = setTimeout(function () { toastEl.classList.remove("show"); }, 2200); }
  function flashCombo(msg) {
    var c = document.createElement("div"); c.className = "combo show"; c.textContent = msg; document.body.appendChild(c);
    setTimeout(function () { c.remove(); }, 1200);
  }

  /* ---- 启动 ---- */
  if (!Q.length) { setScreen('<div class="card">题库为空：请确认 questions.js 已正确加载。</div>'); return; }
  renderHome();
})();

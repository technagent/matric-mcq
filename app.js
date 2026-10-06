(function () {
  "use strict";

  var TEST_SIZE = 60;
  var MARKS_EACH = 0.5;
  var DURATION_MIN = 120;
  var STORE_KEY = "fbise-mcq-test-v1";
  var LETTERS = ["A", "B", "C", "D"];

  var bank = window.QUESTION_BANK || [];
  var byId = {};
  bank.forEach(function (s) {
    s.chapters.forEach(function (c) {
      c.questions.forEach(function (q) { q.subject = s.name; byId[q.id] = q; });
    });
  });

  var $ = function (id) { return document.getElementById(id); };
  var el = function (tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  };

  /* ---------- storage (best effort: the app works without it) ---------- */
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(test)); } catch (e) { /* ignore */ }
  }
  function load() {
    try { return JSON.parse(localStorage.getItem(STORE_KEY) || "null"); } catch (e) { return null; }
  }
  function clearSaved() {
    try { localStorage.removeItem(STORE_KEY); } catch (e) { /* ignore */ }
  }

  var test = null;        // the current / last test
  var timerId = null;
  var setup = { subject: null, chapters: [] };

  function show(screen) {
    ["setup", "test", "result", "review"].forEach(function (s) {
      $("screen-" + s).hidden = s !== screen;
    });
    $("timer").hidden = screen !== "test";
    window.scrollTo(0, 0);
  }

  /* =================== SETUP =================== */
  function renderSubjects() {
    var list = $("subject-list");
    list.innerHTML = "";
    if (!bank.length) {
      list.appendChild(el("p", "muted", "No question bank found. Run tools/import_papers.py first."));
      return;
    }
    bank.forEach(function (s) {
      var total = s.chapters.reduce(function (n, c) { return n + c.questions.length; }, 0);
      var b = el("button", "choice");
      b.type = "button";
      b.appendChild(el("span", null, s.name));
      b.appendChild(el("span", "count", total + " MCQs"));
      b.onclick = function () { selectSubject(s.id); };
      b.dataset.id = s.id;
      list.appendChild(b);
    });
  }

  function selectSubject(id) {
    setup.subject = bank.filter(function (s) { return s.id === id; })[0];
    setup.chapters = [];
    Array.prototype.forEach.call($("subject-list").children, function (b) {
      b.classList.toggle("selected", b.dataset.id === id);
    });
    var list = $("chapter-list");
    list.innerHTML = "";
    setup.subject.chapters.forEach(function (c) {
      var lab = el("label", "choice");
      var cb = el("input");
      cb.type = "checkbox";
      cb.value = c.chapter;
      cb.onchange = function () {
        lab.classList.toggle("selected", cb.checked);
        syncChapters();
      };
      lab.appendChild(cb);
      lab.appendChild(el("span", null, "Chapter " + c.chapter));
      lab.appendChild(el("span", "count", c.questions.length));
      list.appendChild(lab);
    });
    $("all-chapters").checked = false;
    $("chapter-field").hidden = false;
    syncChapters();
  }

  function syncChapters() {
    var boxes = $("chapter-list").querySelectorAll("input");
    setup.chapters = [];
    Array.prototype.forEach.call(boxes, function (b) { if (b.checked) setup.chapters.push(+b.value); });
    $("all-chapters").checked = boxes.length > 0 && setup.chapters.length === boxes.length;
    var pool = poolFor(setup.subject, setup.chapters).length;
    $("pool-info").textContent = setup.chapters.length
      ? pool + " MCQs available — the test will use " + Math.min(TEST_SIZE, pool) + " random questions."
      : "Select one or more chapters, or tick “All chapters”.";
    $("start-btn").disabled = pool === 0;
  }

  $("all-chapters").onchange = function () {
    var on = this.checked;
    Array.prototype.forEach.call($("chapter-list").querySelectorAll("input"), function (b) {
      b.checked = on;
      b.parentNode.classList.toggle("selected", on);
    });
    syncChapters();
  };

  function poolFor(subject, chapters) {
    if (!subject) return [];
    var out = [];
    subject.chapters.forEach(function (c) {
      if (chapters.indexOf(c.chapter) >= 0) out = out.concat(c.questions);
    });
    return out;
  }

  function shuffle(a) {
    for (var i = a.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
  }

  $("start-btn").onclick = function () {
    var pool = shuffle(poolFor(setup.subject, setup.chapters).slice());
    var picked = pool.slice(0, TEST_SIZE);
    var now = Date.now();
    test = {
      student: $("student-name").value.trim(),
      subject: setup.subject.name,
      chapters: setup.chapters.slice().sort(function (a, b) { return a - b; }),
      allChapters: setup.chapters.length === setup.subject.chapters.length,
      ids: picked.map(function (q) { return q.id; }),
      answers: {},
      current: 0,
      startedAt: now,
      endsAt: now + DURATION_MIN * 60 * 1000,
      submittedAt: null
    };
    save();
    startTest();
  };

  /* =================== TEST =================== */
  function startTest() {
    buildPalette();
    renderQuestion();
    show("test");
    tick();
    clearInterval(timerId);
    timerId = setInterval(tick, 1000);
  }

  function tick() {
    var left = Math.max(0, test.endsAt - Date.now());
    var s = Math.ceil(left / 1000);
    $("timer-value").textContent = Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
    $("timer").classList.toggle("warn", s <= 600 && s > 120);
    $("timer").classList.toggle("danger", s <= 120);
    if (left <= 0) submit(true);
  }

  function buildPalette() {
    var p = $("palette");
    p.innerHTML = "";
    test.ids.forEach(function (_, i) {
      var b = el("button", "pal", String(i + 1));
      b.type = "button";
      b.onclick = function () { go(i); };
      p.appendChild(b);
    });
  }

  function updatePalette() {
    var count = 0;
    Array.prototype.forEach.call($("palette").children, function (b, i) {
      var answered = test.answers[i] != null;
      if (answered) count++;
      b.classList.toggle("answered", answered);
      b.classList.toggle("current", i === test.current);
    });
    $("answered-count").textContent = count + " / " + test.ids.length + " answered";
  }

  function renderQuestion() {
    var i = test.current;
    var q = byId[test.ids[i]];
    $("q-counter").textContent = "Question " + (i + 1) + " of " + test.ids.length;
    $("q-chapter").textContent = "Chapter " + q.chapter;
    $("q-scenario").hidden = !q.scenario;
    $("q-scenario-text").textContent = q.scenario || "";
    $("q-text").textContent = q.question;
    var box = $("q-options");
    box.innerHTML = "";
    q.options.forEach(function (opt, k) {
      var b = el("button", "option" + (test.answers[i] === k ? " selected" : ""));
      b.type = "button";
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", test.answers[i] === k ? "true" : "false");
      b.appendChild(el("span", "opt-letter", LETTERS[k]));
      b.appendChild(el("span", "opt-text", opt));
      b.onclick = function () { choose(k); };
      box.appendChild(b);
    });
    $("prev-btn").disabled = i === 0;
    $("next-btn").textContent = i === test.ids.length - 1 ? "Finish" : "Next →";
    $("clear-btn").disabled = test.answers[i] == null;
    updatePalette();
  }

  function choose(k) {
    test.answers[test.current] = k;
    save();
    renderQuestion();
  }

  function go(i) {
    if (i < 0 || i >= test.ids.length) return;
    test.current = i;
    save();
    renderQuestion();
    if (window.innerWidth <= 860) $("screen-test").scrollIntoView();
  }

  $("prev-btn").onclick = function () { go(test.current - 1); };
  $("next-btn").onclick = function () {
    if (test.current === test.ids.length - 1) askSubmit(); else go(test.current + 1);
  };
  $("clear-btn").onclick = function () {
    delete test.answers[test.current];
    save();
    renderQuestion();
  };
  $("submit-btn").onclick = askSubmit;

  function askSubmit() {
    var unanswered = test.ids.length - Object.keys(test.answers).length;
    $("modal-text").textContent = unanswered
      ? "You have " + unanswered + " unanswered question" + (unanswered > 1 ? "s" : "") +
        ". Once submitted, you cannot change your answers."
      : "You have answered all questions. Once submitted, you cannot change your answers.";
    $("modal").hidden = false;
    $("modal-ok").focus();
  }
  $("modal-cancel").onclick = function () { $("modal").hidden = true; };
  $("modal-ok").onclick = function () { $("modal").hidden = true; submit(false); };

  document.addEventListener("keydown", function (e) {
    if ($("screen-test").hidden || !$("modal").hidden || e.target.tagName === "INPUT") return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    var k = e.key.toUpperCase();
    var idx = LETTERS.indexOf(k) >= 0 ? LETTERS.indexOf(k) : "1234".indexOf(k);
    if (idx >= 0 && k.length === 1) { choose(idx); e.preventDefault(); }
    else if (e.key === "ArrowRight") go(test.current + 1);
    else if (e.key === "ArrowLeft") go(test.current - 1);
  });

  window.addEventListener("beforeunload", function (e) {
    if (test && !test.submittedAt && !$("screen-test").hidden) { e.preventDefault(); e.returnValue = ""; }
  });

  function submit(timeUp) {
    if (!test || test.submittedAt) return;
    clearInterval(timerId);
    test.submittedAt = Math.min(Date.now(), test.endsAt);
    test.timeUp = !!timeUp;
    save();
    $("modal").hidden = true;
    showResult();
  }

  /* =================== RESULT =================== */
  function score() {
    var r = { correct: 0, wrong: 0, skipped: 0 };
    test.ids.forEach(function (id, i) {
      var a = test.answers[i];
      if (a == null) r.skipped++;
      else if (a === byId[id].answer) r.correct++;
      else r.wrong++;
    });
    r.marks = r.correct * MARKS_EACH;
    r.total = test.ids.length * MARKS_EACH;
    r.percent = r.total ? (r.marks / r.total) * 100 : 0;
    return r;
  }

  function grade(p) {
    if (p >= 80) return "A1";
    if (p >= 70) return "A";
    if (p >= 60) return "B";
    if (p >= 50) return "C";
    if (p >= 40) return "D";
    if (p >= 33) return "E";
    return "F";
  }

  function fmtMarks(m) { return m % 1 ? m.toFixed(1) : String(m); }

  function chaptersLabel() {
    return test.allChapters ? "All chapters" :
      (test.chapters.length === 1 ? "Chapter " : "Chapters ") + test.chapters.join(", ");
  }

  function showResult() {
    var r = score();
    $("result-who").textContent = (test.student ? test.student + " · " : "") +
      test.subject + " · " + chaptersLabel();
    $("score-value").textContent = fmtMarks(r.marks);
    $("score-total").textContent = fmtMarks(r.total);
    document.querySelector(".score-ring").style.setProperty("--pct", r.percent.toFixed(1));
    $("score-percent").textContent = r.percent.toFixed(1) + "%  ·  Grade " + grade(r.percent);
    $("stat-correct").textContent = r.correct;
    $("stat-wrong").textContent = r.wrong;
    $("stat-skipped").textContent = r.skipped;
    var used = Math.round((test.submittedAt - test.startedAt) / 1000);
    $("stat-time").textContent = Math.floor(used / 60) + ":" + String(used % 60).padStart(2, "0");
    var note = "Each correct answer carries " + MARKS_EACH + " mark. No negative marking.";
    if (test.timeUp) note = "Time was up, so the test was submitted automatically. " + note;
    $("result-note").textContent = note;
    show("result");
  }

  $("review-btn").onclick = function () { renderReview("all"); show("review"); };
  $("back-result-btn").onclick = function () { show("result"); };
  $("print-btn").onclick = function () { window.print(); };
  $("new-test-btn").onclick = function () {
    test = null;
    clearSaved();
    $("resume-box").hidden = true;
    show("setup");
  };

  /* =================== REVIEW =================== */
  Array.prototype.forEach.call(document.querySelectorAll(".filter"), function (b) {
    b.onclick = function () { renderReview(b.dataset.filter); };
  });

  function renderReview(filter) {
    Array.prototype.forEach.call(document.querySelectorAll(".filter"), function (b) {
      b.classList.toggle("active", b.dataset.filter === filter);
    });
    var r = score();
    $("review-summary").textContent = test.subject + " · " + chaptersLabel() + " · " +
      fmtMarks(r.marks) + "/" + fmtMarks(r.total) + " marks";
    var list = $("review-list");
    list.innerHTML = "";
    var shown = 0;
    test.ids.forEach(function (id, i) {
      var q = byId[id];
      var a = test.answers[i];
      var status = a == null ? "skipped" : (a === q.answer ? "correct" : "wrong");
      if (filter !== "all" && filter !== status) return;
      shown++;
      var card = el("div", "card rq " + status);
      var head = el("div", "rq-head");
      head.appendChild(el("strong", null, "Q" + (i + 1) + "  ·  Chapter " + q.chapter));
      head.appendChild(el("span", "badge " + status,
        status === "correct" ? "Correct  +" + MARKS_EACH : status === "wrong" ? "Wrong  0" : "Not attempted  0"));
      card.appendChild(head);
      if (q.scenario) {
        var sc = el("div", "scenario");
        sc.appendChild(el("div", "scenario-label", "Scenario"));
        sc.appendChild(el("div", "scenario-text", q.scenario));
        card.appendChild(sc);
      }
      card.appendChild(el("p", "q-text", q.question));
      var opts = el("div", "options");
      q.options.forEach(function (opt, k) {
        var cls = "option";
        var tag = "";
        if (k === q.answer) { cls += " is-answer"; tag = a === k ? "✓ Your answer" : "✓ Correct answer"; }
        else if (k === a) { cls += " is-wrong"; tag = "✗ Your answer"; }
        var row = el("div", cls);
        row.appendChild(el("span", "opt-letter", LETTERS[k]));
        row.appendChild(el("span", "opt-text", opt));
        if (tag) row.appendChild(el("span", "opt-tag", tag));
        opts.appendChild(row);
      });
      card.appendChild(opts);
      list.appendChild(card);
    });
    if (!shown) list.appendChild(el("div", "card empty muted", "No questions in this category."));
  }

  /* =================== BOOT =================== */
  renderSubjects();
  if (bank.length === 1) selectSubject(bank[0].id);

  var saved = load();
  if (saved && saved.ids && saved.ids.every(function (id) { return byId[id]; })) {
    test = saved;
    if (test.submittedAt) {
      showResult();
    } else {
      $("resume-box").hidden = false;
      show("setup");
    }
  } else {
    show("setup");
  }

  $("resume-btn").onclick = function () {
    $("resume-box").hidden = true;
    if (Date.now() >= test.endsAt) submit(true); else startTest();
  };
  $("discard-btn").onclick = function () {
    test = null;
    clearSaved();
    $("resume-box").hidden = true;
  };
})();

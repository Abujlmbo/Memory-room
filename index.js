(function (exports, metro, common, patcher, utils, plugin, vstorage, ui, toasts, components) {
  "use strict";

  var findByStoreName = metro.findByStoreName;
  var findByTypeName = metro.findByTypeName;
  var React = common.React;
  var ReactNative = common.ReactNative;
  var FluxDispatcher = common.FluxDispatcher;
  var stylesheet = common.stylesheet;
  var after = patcher.after;
  var storage = plugin.storage;
  var useProxy = vstorage.useProxy;
  var semanticColors = ui.semanticColors;
  var showToast = toasts.showToast;
  var ErrorBoundary = components.ErrorBoundary || React.Fragment;

  var View = ReactNative.View;
  var Text = ReactNative.Text;
  var TextInput = ReactNative.TextInput;
  var Pressable = ReactNative.Pressable;

  var UserStore = findByStoreName("UserStore");
  var VoiceStateStore = findByStoreName("VoiceStateStore");
  var SelectedChannelStore = findByStoreName("SelectedChannelStore");

  if (!storage.people) storage.people = {};

  /* ---------- تسجيل الأشخاص ---------- */
  var currentChannel = null;
  var seenThisSession = new Set();

  function remember(userId) {
    var me = UserStore.getCurrentUser() && UserStore.getCurrentUser().id;
    if (!userId || userId === me) return;

    var user = UserStore.getUser(userId);
    var now = Date.now();
    var p = storage.people[userId] || {
      name: (user && user.username) || userId,
      first: now,
      count: 0,
      rating: 0,
      note: ""
    };

    p.name = (user && user.username) || p.name;
    p.last = now;

    if (!seenThisSession.has(userId)) {
      seenThisSession.add(userId);
      p.count += 1;
      if (p.count > 1) {
        var stars = p.rating ? " (" + p.rating + "/5)" : "";
        showToast("شفته قبل: " + p.name + stars);
      }
    }
    storage.people[userId] = p;
  }

  function onVoiceUpdate() {
    var myChannel = SelectedChannelStore.getVoiceChannelId();
    if (myChannel !== currentChannel) {
      currentChannel = myChannel;
      seenThisSession.clear();
    }
    if (!myChannel) return;
    var states = VoiceStateStore.getVoiceStatesForChannel(myChannel) || {};
    Object.keys(states).forEach(remember);
  }

  /* ---------- قسم البروفايل (شكل تقييمات قوقل ماب) ---------- */
  var styles = stylesheet.createThemedStyleSheet({
    card: {
      backgroundColor: semanticColors.CARD_PRIMARY_BG,
      borderRadius: 12,
      padding: 14,
      marginTop: 12,
      gap: 10
    },
    header: {
      flexDirection: "row",
      justifyContent: "space-between",
      alignItems: "center"
    },
    title: { color: semanticColors.TEXT_NORMAL, fontSize: 16, fontWeight: "bold" },
    meta: { color: semanticColors.TEXT_MUTED, fontSize: 12 },
    starsRow: { flexDirection: "row", alignItems: "center", gap: 4 },
    starFilled: { color: "#FBBC04", fontSize: 34 },
    starEmpty: { color: "#9AA0A6", fontSize: 34 },
    ratingText: { color: semanticColors.TEXT_MUTED, fontSize: 13, marginStart: 8 },
    opinionLabel: { color: semanticColors.TEXT_NORMAL, fontSize: 14, fontWeight: "600" },
    input: {
      color: semanticColors.TEXT_NORMAL,
      backgroundColor: semanticColors.CARD_SECONDARY_BG,
      borderRadius: 8,
      padding: 10,
      minHeight: 70,
      textAlignVertical: "top"
    }
  });

  function MemorySection(props) {
    useProxy(storage);
    var id = props.userId;
    var saved = storage.people[id];
    // يظهر القسم لكل الناس؛ السجل ينحفظ أول ما تقيّم أو تكتب رأي
    var p = saved || { count: 0, rating: 0, note: "", last: null };
    var ensure = function () {
      if (!storage.people[id]) {
        var u = UserStore.getUser(id);
        storage.people[id] = {
          name: (u && u.username) || id,
          first: Date.now(),
          last: Date.now(),
          count: 0,
          rating: 0,
          note: ""
        };
      }
      return storage.people[id];
    };

    var fmt = function (t) {
      return new Date(t).toLocaleDateString("ar-SA");
    };

    return React.createElement(
      ErrorBoundary,
      null,
      React.createElement(
        View,
        { style: styles.card },
        React.createElement(
          View,
          { style: styles.header },
          React.createElement(Text, { style: styles.title }, "ذاكرتي"),
          React.createElement(
            Text,
            { style: styles.meta },
            saved ? "قابلته " + p.count + " مرة • آخر مرة " + fmt(p.last) : "ما قابلته بعد في روم"
          )
        ),
        React.createElement(
          View,
          { style: styles.starsRow },
          [1, 2, 3, 4, 5].map(function (n) {
            return React.createElement(
              Pressable,
              {
                key: n,
                hitSlop: 4,
                onPress: function () {
                  var r = ensure();
                  r.rating = r.rating === n ? 0 : n;
                }
              },
              React.createElement(
                Text,
                { style: n <= p.rating ? styles.starFilled : styles.starEmpty },
                "★"
              )
            );
          }),
          React.createElement(
            Text,
            { style: styles.ratingText },
            p.rating ? p.rating + "/5" : "بدون تقييم"
          )
        ),
        React.createElement(Text, { style: styles.opinionLabel }, "الرأي"),
        React.createElement(TextInput, {
          style: styles.input,
          value: p.note,
          placeholder: "اكتب رأيك فيه (تشوفه أنت بس)",
          placeholderTextColor: "#888",
          multiline: true,
          onChangeText: function (t) {
            ensure().note = t;
          }
        })
      )
    );
  }

  /* ---------- أدوات بحث آمنة في شجرة React ---------- */
  var unpatches = [];
  var injected = false;
  var lastProfileUserId = null;
  var warnedPages = false;

  var PAGES_RE = /(Bio|AboutMe|MemberSince)/i;

  function nameOf(el) {
    try {
      if (!el || typeof el !== "object" || !el.type) return "";
      var t = el.type;
      if (typeof t === "string") return t;
      return t.displayName || t.name || (t.type && (t.type.displayName || t.type.name)) || "";
    } catch (e) {
      return "";
    }
  }

  // بحث يدوي بدون findInReactTree (ما يرمي أخطاء)
  function walkTree(node, cb, depth) {
    depth = depth || 0;
    if (!node || typeof node !== "object" || depth > 40) return null;
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i++) {
        var r = walkTree(node[i], cb, depth + 1);
        if (r) return r;
      }
      return null;
    }
    var hit = false;
    try { hit = cb(node); } catch (e) {}
    if (hit) return node;
    var ch;
    if (node.props && node.props.children !== undefined) ch = node.props.children;
    else if (node.children !== undefined) ch = node.children;
    return walkTree(ch, cb, depth + 1);
  }

  function hasBioChild(c) {
    var ch = c && c.props && c.props.children;
    if (!Array.isArray(ch)) return false;
    return ch.some(function (l) {
      var n = nameOf(l);
      return n && PAGES_RE.test(n);
    });
  }

  function collectNames(node, seen) {
    walkTree(node, function (c) {
      var n = nameOf(c);
      if (n && seen.indexOf(n) < 0 && seen.length < 100) seen.push(n);
      return false;
    });
  }

  /* ---------- نلتقط userId من شاشة البروفايل الرئيسية ---------- */
  function patchProfile(Component) {
    if (!Component) return;
    unpatches.push(
      after("type", Component, function (args) {
        var props = args[0];
        var userId = props && (props.userId || (props.user && props.user.id));
        if (userId) lastProfileUserId = userId;
      })
    );
  }

  /* ---------- الحقن في صفحات التبويب (مثل ReviewDB) ---------- */
  function patchPages() {
    var finder =
      metro.findByFilePath ||
      (typeof bunny !== "undefined" && bunny.metro && bunny.metro.findByFilePath);
    var Pages;
    try {
      Pages = finder && finder("design/components/SegmentedControl/native/SegmentedControlPages.native.tsx");
    } catch (e) {}
    if (!Pages) return false;

    unpatches.push(
      after("SegmentedControlPages", Pages, function (args, ret) {
        var userId = lastProfileUserId;
        if (!userId) return;

        var props = args[0] || {};
        var pages = props.pages;
        var pageList = Array.isArray(pages)
          ? pages
          : pages && typeof pages === "object"
          ? Object.keys(pages).map(function (k) { return pages[k]; })
          : [];

        // 1) نبحث في الناتج 2) ثم داخل الصفحات الممرّرة
        var found = walkTree(ret, hasBioChild);
        if (!found) {
          for (var i = 0; i < pageList.length && !found; i++) {
            found = walkTree(pageList[i], hasBioChild);
          }
        }
        var children = found && found.props && found.props.children;

        if (!children) {
          if (!warnedPages) {
            warnedPages = true;
            var info = [];
            info.push("retType=" + typeof ret + " retName=" + nameOf(ret));
            try { info.push("propsKeys=" + Object.keys(props).join(",")); } catch (e) {}
            info.push("pages=" + (Array.isArray(pages) ? "array(" + pages.length + ")" : typeof pages));
            if (pageList[0] && typeof pageList[0] === "object") {
              try { info.push("page0Keys=" + Object.keys(pageList[0]).join(",")); } catch (e) {}
              info.push("page0Children=" + typeof pageList[0].children + " " + nameOf(pageList[0].children));
            }
            var seen = [];
            collectNames(ret, seen);
            var seenPages = [];
            pageList.forEach(function (pg) { collectNames(pg, seenPages); });
            info.push("RET_NAMES: " + seen.join(", "));
            info.push("PAGES_NAMES: " + seenPages.join(", "));
            try { common.clipboard.setString(info.join("\n")); } catch (e) {}
            showToast("VM: ما لقيت البايو، نسخت تفاصيل للحافظة");
          }
          return;
        }

        var el = React.createElement(MemorySection, { userId: userId, key: "vm-memory" });
        try {
          var idx = children.findIndex(function (c) { return c && c.type === MemorySection; });
          if (idx >= 0) children[idx] = el;
          else children.push(el);
        } catch (e) {}

        if (!injected) {
          injected = true;
          showToast("VM: تم حقن القسم في تبويب Main");
        }
      })
    );
    return true;
  }

  exports.onLoad = function () {
    FluxDispatcher.subscribe("VOICE_STATE_UPDATES", onVoiceUpdate);

    var UserProfile = findByTypeName("UserProfile") || findByTypeName("UserProfileContent");
    patchProfile(UserProfile);
    var Simplified = findByTypeName("SimplifiedUserProfileContent");
    patchProfile(Simplified);

    var pagesOk = patchPages();

    showToast("VM تحمّل | profile=" + !!UserProfile + " | pages=" + pagesOk);
  };

  exports.onUnload = function () {
    FluxDispatcher.unsubscribe("VOICE_STATE_UPDATES", onVoiceUpdate);
    unpatches.forEach(function (u) { u(); });
    unpatches.length = 0;
  };

  return exports;
})(
  {},
  vendetta.metro,
  vendetta.metro.common,
  vendetta.patcher,
  vendetta.utils,
  vendetta.plugin,
  vendetta.storage,
  vendetta.ui,
  vendetta.ui.toasts,
  vendetta.ui.components
);

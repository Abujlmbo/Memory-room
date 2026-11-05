(function (exports, metro, common, patcher, utils, plugin, vstorage, ui, toasts, components) {
  "use strict";

  var findByStoreName = metro.findByStoreName;
  var findByTypeName = metro.findByTypeName;
  var React = common.React;
  var ReactNative = common.ReactNative;
  var FluxDispatcher = common.FluxDispatcher;
  var stylesheet = common.stylesheet;
  var after = patcher.after;
  var findInReactTree = utils.findInReactTree;
  var storage = plugin.storage;
  var useProxy = vstorage.useProxy;
  var semanticColors = ui.semanticColors;
  var showToast = toasts.showToast;
  var ErrorBoundary = components.ErrorBoundary;

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
    var p = storage.people[props.userId];
    if (!p) return null;

    var fmt = function (t) {
      return new Date(t).toLocaleDateString("ar-SA");
    };

    return React.createElement(
      ErrorBoundary,
      null,
      React.createElement(
        View,
        { style: styles.card },
        // العنوان + عدد المرات
        React.createElement(
          View,
          { style: styles.header },
          React.createElement(Text, { style: styles.title }, "ذاكرتي"),
          React.createElement(
            Text,
            { style: styles.meta },
            "قابلته " + p.count + " مرة • آخر مرة " + fmt(p.last)
          )
        ),
        // النجوم (الضغط على نفس النجمة مرة ثانية يصفّر التقييم)
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
                  p.rating = p.rating === n ? 0 : n;
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
        // الرأي
        React.createElement(Text, { style: styles.opinionLabel }, "الرأي"),
        React.createElement(TextInput, {
          style: styles.input,
          value: p.note,
          placeholder: "اكتب رأيك فيه (تشوفه أنت بس)",
          placeholderTextColor: "#888",
          multiline: true,
          onChangeText: function (t) {
            p.note = t;
          }
        })
      )
    );
  }

  /* ---------- الحقن في البروفايل ---------- */
  var unpatches = [];

  function patchProfile(Component, bioNames) {
    if (!Component) return;
    unpatches.push(
      after("type", Component, function (args, tree) {
        var props = args[0];
        var found = findInReactTree(tree, function (c) {
          return (
            c && c.type && c.type.displayName === "View" &&
            c.props && c.props.children && c.props.children.findIndex &&
            c.props.children.findIndex(function (l) {
              return l && l.type && bioNames.indexOf(l.type.name) >= 0;
            }) >= 0
          );
        });
        var children = found && found.props && found.props.children;
        var userId = props && (props.userId || (props.user && props.user.id));
        if (!children || !userId) return;
        children.push(React.createElement(MemorySection, { userId: userId }));
      })
    );
  }

  exports.onLoad = function () {
    FluxDispatcher.subscribe("VOICE_STATE_UPDATES", onVoiceUpdate);

    var UserProfile = findByTypeName("UserProfile") || findByTypeName("UserProfileContent");
    patchProfile(UserProfile, ["UserProfileBio", "UserProfileAboutMeCard"]);

    var Simplified = findByTypeName("SimplifiedUserProfileContent");
    patchProfile(Simplified, ["SimplifiedUserProfileAboutMeCard"]);
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

package org.yaelfoundation.summit;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ComponentName;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.content.pm.ShortcutInfo;
import android.content.pm.ShortcutManager;
import android.graphics.drawable.Icon;
import android.nfc.NfcAdapter;
import android.nfc.cardemulation.CardEmulation;
import android.provider.ContactsContract;
import android.provider.Settings;
import android.webkit.PermissionRequest;
import org.json.JSONObject;
import com.google.firebase.messaging.FirebaseMessaging;
import java.util.Arrays;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.CookieManager;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

/**
 * Yael Summit for Android: the live site in a full-screen WebView.
 * Everything (accounts, connections, messages, the board) comes from the site and its
 * database, so the app is always up to date without reinstalling.
 */
public class MainActivity extends Activity {
    private static final int FILE_REQUEST = 1001;
    private static final int CAMERA_REQUEST = 1002;
    private static final int NOTIFY_REQUEST = 1003;
    private static final String HOME = BuildConfig.SITE_URL + "/";

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private String lastUrl = HOME;
    private PermissionRequest pendingCamera;   // the scanner asked for the camera; waiting for the user
    private String sharingUrl;                 // the meet link offered by NFC while "Meet in person" is open
    private boolean resumed;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);

        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.parseColor("#05070E"));
        web = new WebView(this);
        web.setBackgroundColor(Color.parseColor("#05070E"));
        root.addView(web, new FrameLayout.LayoutParams(FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setContentView(root);
        keepClearOfSystemBars(root);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);            // the site remembers day/night and map colours
        s.setDatabaseEnabled(true);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setAllowFileAccess(false);
        s.setSupportMultipleWindows(false);       // target=_blank opens in place
        s.setUserAgentString(s.getUserAgentString() + " YaelSummitApp/" + BuildConfig.VERSION_NAME);

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);           // the sign-in cookie
        cookies.setAcceptThirdPartyCookies(web, false);

        web.addJavascriptInterface(new Bridge(), "Android");
        web.setWebViewClient(new Client());
        web.setWebChromeClient(new Chrome());

        if (state != null) web.restoreState(state);
        else web.loadUrl(startUrl(getIntent()));
        addShortcuts();
        NotifyJob.createChannel(this);
        NotifyJob.schedule(this);
        if (BuildConfig.HAS_FCM) {
            try {
                FirebaseMessaging.getInstance().getToken().addOnSuccessListener((token) ->
                    getSharedPreferences("notify", MODE_PRIVATE).edit().putString("fcm", token).apply());
            } catch (Exception ignored) { /* Google Play services missing: the periodic check still works */ }
        }
    }

    /** Long-press the app icon: "My code" and "Scan a code". */
    private void addShortcuts() {
        if (Build.VERSION.SDK_INT < 25) return;
        ShortcutManager sm = getSystemService(ShortcutManager.class);
        if (sm == null) return;
        sm.setDynamicShortcuts(Arrays.asList(
            shortcut("meet", "My code", "Show my code", "#/meet"),
            shortcut("scan", "Scan a code", "Scan a code", "#/scan")));
    }

    private ShortcutInfo shortcut(String id, String shortLabel, String longLabel, String hash) {
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse(BuildConfig.SITE_URL + "/" + hash), this, MainActivity.class);
        return new ShortcutInfo.Builder(this, id)
            .setShortLabel(shortLabel).setLongLabel(longLabel)
            .setIcon(Icon.createWithResource(this, R.mipmap.ic_launcher))
            .setIntent(open).build();
    }

    /** Opens the app at a page of the site when launched from a link to it. */
    private String startUrl(Intent intent) {
        Uri data = intent != null ? intent.getData() : null;
        if (data != null && isOurs(data)) return data.toString();
        return HOME;
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        Uri data = intent.getData();
        if (data != null && isOurs(data)) web.loadUrl(data.toString());
    }

    /** Pads the page so the status bar and gesture bar never cover it (edge-to-edge on Android 15). */
    private void keepClearOfSystemBars(View root) {
        root.setOnApplyWindowInsetsListener((v, insets) -> {
            int top, bottom, left, right;
            if (Build.VERSION.SDK_INT >= 30) {
                android.graphics.Insets bars = insets.getInsets(WindowInsets.Type.systemBars() | WindowInsets.Type.displayCutout());
                android.graphics.Insets ime = insets.getInsets(WindowInsets.Type.ime());
                top = bars.top; left = bars.left; right = bars.right; bottom = Math.max(bars.bottom, ime.bottom);
            } else {
                top = insets.getSystemWindowInsetTop(); bottom = insets.getSystemWindowInsetBottom();
                left = insets.getSystemWindowInsetLeft(); right = insets.getSystemWindowInsetRight();
            }
            v.setPadding(left, top, right, bottom);
            return insets;
        });
    }

    private static boolean isOurs(Uri uri) {
        return "https".equals(uri.getScheme()) && BuildConfig.SITE_HOST.equalsIgnoreCase(uri.getHost());
    }

    private void openOutside(Uri uri) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, uri).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK));
        } catch (ActivityNotFoundException ignored) { /* nothing on the phone can open it */ }
    }

    private class Client extends WebViewClient {
        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (isOurs(uri)) return false;               // stay in the app
            openOutside(uri);                            // mailto:, tel:, LinkedIn, websites…
            return true;
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            if (url != null && url.startsWith(BuildConfig.SITE_URL)) lastUrl = url;
            CookieManager.getInstance().flush();         // stay signed in after the app closes
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            if (request.isForMainFrame()) view.loadUrl("file:///android_asset/offline.html");
        }
    }

    private class Chrome extends WebChromeClient {
        // The scanner asks for the camera: grant it for the site, asking Android first if needed.
        @Override
        public void onPermissionRequest(PermissionRequest request) {
            boolean ours = isOurs(request.getOrigin());
            boolean wantsCamera = Arrays.asList(request.getResources()).contains(PermissionRequest.RESOURCE_VIDEO_CAPTURE);
            if (!ours || !wantsCamera) { request.deny(); return; }
            if (checkSelfPermission(Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) {
                request.grant(new String[] {PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            } else {
                if (pendingCamera != null) pendingCamera.deny();
                pendingCamera = request;
                requestPermissions(new String[] {Manifest.permission.CAMERA}, CAMERA_REQUEST);
            }
        }

        // Profile photo: the site's <input type="file"> opens the phone's gallery / camera.
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (fileCallback != null) fileCallback.onReceiveValue(null);
            fileCallback = callback;
            Intent pick = params.createIntent();
            pick.addCategory(Intent.CATEGORY_OPENABLE);
            if (pick.getType() == null || pick.getType().isEmpty()) pick.setType("image/*");
            try {
                startActivityForResult(Intent.createChooser(pick, "Choose a photo"), FILE_REQUEST);
            } catch (ActivityNotFoundException e) {
                fileCallback = null;
                return false;
            }
            return true;
        }
    }

    /** What the site can ask the app for (window.Android). */
    private class Bridge {
        /** The offline page's "Try again". */
        @JavascriptInterface
        public void retry() {
            runOnUiThread(() -> web.loadUrl(lastUrl));
        }

        @JavascriptInterface
        public String version() { return BuildConfig.VERSION_NAME; }

        /** The phone's share sheet (WhatsApp, email, …). */
        @JavascriptInterface
        public void share(String title, String url) {
            runOnUiThread(() -> {
                Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain")
                    .putExtra(Intent.EXTRA_SUBJECT, title).putExtra(Intent.EXTRA_TEXT, title + "\n" + url);
                try { startActivity(Intent.createChooser(send, "Share")); } catch (ActivityNotFoundException ignored) { }
            });
        }

        /** Opens the phone's "new contact" screen, filled in. Nothing is saved without the user. */
        @JavascriptInterface
        public void saveContact(String json) {
            runOnUiThread(() -> {
                try {
                    JSONObject c = new JSONObject(json);
                    Intent add = new Intent(ContactsContract.Intents.Insert.ACTION).setType(ContactsContract.RawContacts.CONTENT_TYPE)
                        .putExtra(ContactsContract.Intents.Insert.NAME, c.optString("name"))
                        .putExtra(ContactsContract.Intents.Insert.COMPANY, c.optString("company"))
                        .putExtra(ContactsContract.Intents.Insert.JOB_TITLE, c.optString("title"))
                        .putExtra(ContactsContract.Intents.Insert.NOTES, c.optString("note"));
                    if (!c.optString("email").isEmpty()) add.putExtra(ContactsContract.Intents.Insert.EMAIL, c.optString("email"));
                    if (!c.optString("phone").isEmpty()) add.putExtra(ContactsContract.Intents.Insert.PHONE, c.optString("phone"));
                    startActivity(add);
                } catch (Exception ignored) { }
            });
        }

        /** "none" (no NFC, or can't act as a tag), "off" (NFC turned off) or "on". */
        @JavascriptInterface
        public String nfcState() {
            NfcAdapter nfc = NfcAdapter.getDefaultAdapter(MainActivity.this);
            if (nfc == null || !getPackageManager().hasSystemFeature(PackageManager.FEATURE_NFC_HOST_CARD_EMULATION)) return "none";
            return nfc.isEnabled() ? "on" : "off";
        }

        @JavascriptInterface
        public void openNfcSettings() {
            runOnUiThread(() -> {
                try { startActivity(new Intent(Settings.ACTION_NFC_SETTINGS)); }
                catch (ActivityNotFoundException e) { startActivity(new Intent(Settings.ACTION_WIRELESS_SETTINGS)); }
            });
        }

        /** Offers a meet link to phones tapped against this one. Only links to the site. */
        @JavascriptInterface
        public boolean nfcShare(String url) {
            if (url == null || !isOurs(Uri.parse(url)) || !"on".equals(nfcState())) return false;
            runOnUiThread(() -> { sharingUrl = url; if (resumed) startNfcSharing(); });
            return true;
        }

        /** This install's Firebase token ("" until Firebase answers, or without Firebase). The site saves it. */
        @JavascriptInterface
        public String pushToken() { return getSharedPreferences("notify", MODE_PRIVATE).getString("fcm", ""); }

        /** Phone notifications: "on" or "off". */
        @JavascriptInterface
        public String notifState() { return NotifyJob.allowed(MainActivity.this) ? "on" : "off"; }

        /** Asks Android for permission (13+), or opens the app's notification settings if it was refused. */
        @JavascriptInterface
        public void enableNotifications() {
            runOnUiThread(() -> {
                SharedPreferences prefs = getSharedPreferences("notify", MODE_PRIVATE);
                boolean asked = prefs.getBoolean("asked", false);
                if (Build.VERSION.SDK_INT >= 33 && checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
                        && (!asked || shouldShowRequestPermissionRationale(Manifest.permission.POST_NOTIFICATIONS))) {
                    prefs.edit().putBoolean("asked", true).apply();
                    requestPermissions(new String[] {Manifest.permission.POST_NOTIFICATIONS}, NOTIFY_REQUEST);
                } else if (!NotifyJob.allowed(MainActivity.this)) {
                    Intent settings = Build.VERSION.SDK_INT >= 26
                        ? new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).putExtra(Settings.EXTRA_APP_PACKAGE, getPackageName())
                        : new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getPackageName()));
                    try { startActivity(settings); } catch (ActivityNotFoundException ignored) { }
                }
                NotifyJob.schedule(MainActivity.this);
            });
        }

        @JavascriptInterface
        public void nfcStop() {
            runOnUiThread(() -> { sharingUrl = null; stopNfcSharing(); });
        }
    }

    private void startNfcSharing() {
        NfcCardService.share(sharingUrl);
        NfcAdapter nfc = NfcAdapter.getDefaultAdapter(this);
        if (nfc == null) return;
        try { CardEmulation.getInstance(nfc).setPreferredService(this, new ComponentName(this, NfcCardService.class)); }
        catch (Exception ignored) { /* not supported: the service still answers for its AID */ }
    }

    private void stopNfcSharing() {
        NfcCardService.share(null);
        NfcAdapter nfc = NfcAdapter.getDefaultAdapter(this);
        if (nfc == null) return;
        try { CardEmulation.getInstance(nfc).unsetPreferredService(this); } catch (Exception ignored) { }
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        if (requestCode == CAMERA_REQUEST && pendingCamera != null) {
            if (results.length > 0 && results[0] == PackageManager.PERMISSION_GRANTED) pendingCamera.grant(new String[] {PermissionRequest.RESOURCE_VIDEO_CAPTURE});
            else pendingCamera.deny();
            pendingCamera = null;
            return;
        }
        super.onRequestPermissionsResult(requestCode, permissions, results);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == FILE_REQUEST && fileCallback != null) {
            fileCallback.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data));
            fileCallback = null;
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onBackPressed() {
        String url = web.getUrl();
        if (url != null && url.startsWith("file:")) { web.loadUrl(lastUrl); return; }
        if (web.canGoBack()) web.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onSaveInstanceState(Bundle out) {
        super.onSaveInstanceState(out);
        web.saveState(out);
    }

    @Override
    protected void onPause() {
        super.onPause();
        resumed = false;
        NotifyJob.appOnScreen = false;
        stopNfcSharing();                         // only share while the app is on screen
        CookieManager.getInstance().flush();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        resumed = true;
        NotifyJob.appOnScreen = true;
        if (sharingUrl != null) startNfcSharing();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }
}

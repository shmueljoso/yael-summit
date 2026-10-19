package org.yaelfoundation.summit;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
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
    private static final String HOME = BuildConfig.SITE_URL + "/";

    private WebView web;
    private ValueCallback<Uri[]> fileCallback;
    private String lastUrl = HOME;

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

    /** Lets the offline page try again. */
    private class Bridge {
        @JavascriptInterface
        public void retry() {
            runOnUiThread(() -> web.loadUrl(lastUrl));
        }
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
        CookieManager.getInstance().flush();
        web.onPause();
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
    }

    @Override
    protected void onDestroy() {
        web.destroy();
        super.onDestroy();
    }
}

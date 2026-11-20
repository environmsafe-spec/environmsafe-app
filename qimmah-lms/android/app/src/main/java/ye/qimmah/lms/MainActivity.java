package ye.qimmah.lms;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.app.AlertDialog;
import android.app.DownloadManager;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.NetworkCapabilities;
import android.net.NetworkRequest;
import android.net.Uri;
import android.net.http.SslError;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.os.SystemClock;
import android.text.InputType;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowInsets;
import android.view.WindowManager;
import android.webkit.CookieManager;
import android.webkit.SslErrorHandler;
import android.webkit.URLUtil;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.EditText;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.ProgressBar;
import android.widget.TextView;
import android.widget.Toast;

import java.net.URISyntaxException;
import java.util.Locale;

/**
 * Single-activity WebView wrapper for the Al-Qimmah learning platform.
 * Only the configured server's host is loaded in-app; everything else opens
 * outside. No AndroidX, no JavaScript bridge.
 */
public class MainActivity extends Activity {

    private static final String PREFS = "qimmah";
    private static final String PREF_SERVER_URL = "server_url";
    private static final String USER_AGENT_SUFFIX = " QimmahApp/1.0";
    private static final int REQ_FILE_CHOOSER = 1001;
    private static final int REQ_STORAGE = 1002;
    private static final long BACK_EXIT_WINDOW_MS = 2000;

    private WebView webView;
    private ProgressBar progressBar;
    private View errorView;
    private FrameLayout rootView;

    private ValueCallback<Uri[]> filePathCallback;

    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;
    private int orientationBeforeFullscreen = ActivityInfo.SCREEN_ORIENTATION_UNSPECIFIED;
    private int systemUiBeforeFullscreen;

    private boolean mainFrameError;
    private String failedUrl;
    private boolean clearHistoryOnNextFinish;
    private long lastBackPress;

    private PendingDownload pendingDownload;

    private ConnectivityManager connectivityManager;
    private ConnectivityManager.NetworkCallback networkCallback;

    private static final class PendingDownload {
        final String url, userAgent, contentDisposition, mimeType;

        PendingDownload(String url, String userAgent, String contentDisposition, String mimeType) {
            this.url = url;
            this.userAgent = userAgent;
            this.contentDisposition = contentDisposition;
            this.mimeType = mimeType;
        }
    }

    // ------------------------------------------------------------------ lifecycle

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        rootView = findViewById(R.id.root);
        webView = findViewById(R.id.webview);
        progressBar = findViewById(R.id.progress);
        errorView = findViewById(R.id.error_view);

        Button retry = findViewById(R.id.retry_button);
        retry.setOnClickListener(v -> retry());
        findViewById(R.id.server_settings_link).setOnClickListener(v -> showServerDialog());

        applyEdgeToEdgeInsets();
        configureWebView();
        registerConnectivityCallback();

        boolean restored = false;
        if (savedInstanceState != null) {
            restored = webView.restoreState(savedInstanceState) != null;
        }
        if (!restored) {
            webView.loadUrl(getServerUrl());
        }
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
        webView.resumeTimers();
    }

    @Override
    protected void onPause() {
        CookieManager.getInstance().flush();
        webView.onPause();
        webView.pauseTimers();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        unregisterConnectivityCallback();
        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(null);
            filePathCallback = null;
        }
        if (webView != null) {
            ((ViewGroup) webView.getParent()).removeView(webView);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    /** Android 15 (targetSdk 35) draws apps edge-to-edge: pad content for bars and keyboard. */
    private void applyEdgeToEdgeInsets() {
        if (Build.VERSION.SDK_INT < 35) return;
        rootView.setOnApplyWindowInsetsListener((v, insets) -> {
            android.graphics.Insets i = insets.getInsets(
                    WindowInsets.Type.systemBars() | WindowInsets.Type.ime()
                            | WindowInsets.Type.displayCutout());
            v.setPadding(i.left, i.top, i.right, i.bottom);
            return WindowInsets.CONSUMED;
        });
    }

    // ------------------------------------------------------------------ WebView setup

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setMediaPlaybackRequiresUserGesture(false);
        s.setTextZoom(100);
        s.setCacheMode(WebSettings.LOAD_DEFAULT);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setLoadWithOverviewMode(true);
        s.setUseWideViewPort(true);
        s.setBuiltInZoomControls(false);
        s.setDisplayZoomControls(false);
        if (Build.VERSION.SDK_INT >= 26) {
            s.setSafeBrowsingEnabled(true);
        }
        String ua = s.getUserAgentString();
        if (ua == null || !ua.contains(USER_AGENT_SUFFIX.trim())) {
            s.setUserAgentString((ua == null ? "" : ua) + USER_AGENT_SUFFIX);
        }

        CookieManager cookies = CookieManager.getInstance();
        cookies.setAcceptCookie(true);

        // Navy until the first page paints, so the launch looks like one colour.
        webView.setBackgroundColor(Color.parseColor("#1E3A8A"));

        webView.setWebViewClient(new QimmahWebViewClient());
        webView.setWebChromeClient(new QimmahChromeClient());
        webView.setDownloadListener(this::onDownloadRequested);
    }

    // ------------------------------------------------------------------ server URL

    private SharedPreferences prefs() {
        return getSharedPreferences(PREFS, MODE_PRIVATE);
    }

    private String getServerUrl() {
        String saved = prefs().getString(PREF_SERVER_URL, null);
        if (saved != null && isAllowedServerUrl(saved)) return saved;
        return BuildConfig.SERVER_URL;
    }

    private String getServerHost() {
        String host = Uri.parse(getServerUrl()).getHost();
        return host == null ? "" : host.toLowerCase(Locale.ROOT);
    }

    /**
     * https:// for any host. http:// only for local test hosts: 10.0.2.2 (emulator),
     * localhost / 127.0.0.1, and 192.168.x.x in debug builds (release builds' network
     * security config would block LAN cleartext anyway).
     */
    static boolean isAllowedServerUrl(String url) {
        if (url == null) return false;
        Uri u = Uri.parse(url.trim());
        String scheme = u.getScheme();
        String host = u.getHost();
        if (scheme == null || host == null || host.isEmpty()) return false;
        scheme = scheme.toLowerCase(Locale.ROOT);
        host = host.toLowerCase(Locale.ROOT);
        if ("https".equals(scheme)) return true;
        if ("http".equals(scheme)) {
            if (host.equals("10.0.2.2") || host.equals("localhost") || host.equals("127.0.0.1")) {
                return true;
            }
            return BuildConfig.DEBUG && host.startsWith("192.168.");
        }
        return false;
    }

    private void showServerDialog() {
        float density = getResources().getDisplayMetrics().density;
        int pad = (int) (20 * density);

        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setPadding(pad, pad / 2, pad, 0);

        TextView label = new TextView(this);
        label.setText(R.string.server_url_label);
        label.setTextSize(TypedValue.COMPLEX_UNIT_SP, 15);
        box.addView(label);

        EditText input = new EditText(this);
        input.setInputType(InputType.TYPE_CLASS_TEXT | InputType.TYPE_TEXT_VARIATION_URI);
        input.setSingleLine(true);
        input.setHint(R.string.server_url_hint);
        input.setTextDirection(View.TEXT_DIRECTION_LTR);
        input.setGravity(Gravity.START | Gravity.CENTER_VERTICAL);
        input.setText(getServerUrl());
        input.setSelection(input.getText().length());
        box.addView(input);

        TextView error = new TextView(this);
        error.setTextColor(Color.parseColor("#B91C1C"));
        error.setTextSize(TypedValue.COMPLEX_UNIT_SP, 13);
        error.setVisibility(View.GONE);
        box.addView(error);

        AlertDialog dialog = new AlertDialog.Builder(this, R.style.ServerDialog)
                .setTitle(R.string.server_settings)
                .setView(box)
                .setPositiveButton(R.string.save, null)
                .setNegativeButton(R.string.cancel, null)
                .setNeutralButton(R.string.restore_default, null)
                .create();

        dialog.setOnShowListener(d -> {
            dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
                String url = input.getText().toString().trim();
                if (!isAllowedServerUrl(url)) {
                    error.setText(R.string.server_url_invalid);
                    error.setVisibility(View.VISIBLE);
                    return;
                }
                prefs().edit().putString(PREF_SERVER_URL, url).apply();
                dialog.dismiss();
                loadHomeFresh();
            });
            dialog.getButton(AlertDialog.BUTTON_NEUTRAL).setOnClickListener(v -> {
                prefs().edit().remove(PREF_SERVER_URL).apply();
                dialog.dismiss();
                loadHomeFresh();
            });
        });
        dialog.show();
        if (dialog.getWindow() != null) {
            dialog.getWindow().setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_STATE_VISIBLE);
        }
    }

    private void loadHomeFresh() {
        clearHistoryOnNextFinish = true;
        failedUrl = null;
        webView.loadUrl(getServerUrl());
    }

    // ------------------------------------------------------------------ navigation

    private boolean isInternal(Uri uri) {
        String scheme = uri.getScheme();
        String host = uri.getHost();
        if (scheme == null) return false;
        scheme = scheme.toLowerCase(Locale.ROOT);
        if (!scheme.equals("https") && !scheme.equals("http")) return false;
        return host != null && host.toLowerCase(Locale.ROOT).equals(getServerHost());
    }

    /** @return true if the navigation was handled outside the WebView. */
    private boolean handleTopLevelNavigation(Uri uri) {
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (scheme.equals("about") || scheme.equals("javascript") || scheme.equals("data")
                || scheme.equals("blob")) {
            return false;
        }
        if (isInternal(uri)) return false;
        if (scheme.equals("intent")) {
            openIntentScheme(uri.toString());
            return true;
        }
        if (scheme.equals("file") || scheme.equals("content")) {
            return true; // never load local files
        }
        openExternally(uri);
        return true;
    }

    private void openExternally(Uri uri) {
        Intent intent = new Intent(Intent.ACTION_VIEW, uri);
        intent.addCategory(Intent.CATEGORY_BROWSABLE);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            startActivity(intent);
        } catch (ActivityNotFoundException e) {
            Toast.makeText(this, R.string.no_app_to_open, Toast.LENGTH_SHORT).show();
        }
    }

    private void openIntentScheme(String url) {
        try {
            Intent intent = Intent.parseUri(url, Intent.URI_INTENT_SCHEME);
            intent.addCategory(Intent.CATEGORY_BROWSABLE);
            intent.setComponent(null);
            intent.setSelector(null);
            try {
                startActivity(intent);
                return;
            } catch (ActivityNotFoundException ignored) {
            }
            String fallback = intent.getStringExtra("browser_fallback_url");
            if (fallback != null && fallback.startsWith("https://")) {
                openExternally(Uri.parse(fallback));
                return;
            }
        } catch (URISyntaxException ignored) {
        }
        Toast.makeText(this, R.string.no_app_to_open, Toast.LENGTH_SHORT).show();
    }

    /** Legacy (API < 24) callback cannot tell iframes apart: never intercept embed players. */
    private static boolean isEmbedPlayer(Uri uri) {
        String host = uri.getHost() == null ? "" : uri.getHost().toLowerCase(Locale.ROOT);
        String path = uri.getPath() == null ? "" : uri.getPath();
        boolean yt = host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com");
        boolean vimeo = host.equals("player.vimeo.com");
        return (yt && path.startsWith("/embed/")) || vimeo;
    }

    // ------------------------------------------------------------------ error view

    private void showErrorView(String url) {
        mainFrameError = true;
        if (url != null && !url.startsWith("about:")) failedUrl = url;
        progressBar.setVisibility(View.GONE);
        errorView.setVisibility(View.VISIBLE);
        webView.setVisibility(View.INVISIBLE);
        webView.stopLoading();
    }

    private void hideErrorView() {
        errorView.setVisibility(View.GONE);
        webView.setVisibility(View.VISIBLE);
    }

    private void retry() {
        mainFrameError = false;
        String target = failedUrl != null ? failedUrl : getServerUrl();
        if (target.equals(webView.getUrl())) {
            webView.reload();
        } else {
            webView.loadUrl(target);
        }
    }

    private boolean isErrorShowing() {
        return errorView.getVisibility() == View.VISIBLE;
    }

    private void registerConnectivityCallback() {
        connectivityManager = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (connectivityManager == null) return;
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                runOnUiThread(() -> {
                    if (webView != null && isErrorShowing()) retry();
                });
            }
        };
        try {
            NetworkRequest request = new NetworkRequest.Builder()
                    .addCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    .build();
            connectivityManager.registerNetworkCallback(request, networkCallback);
        } catch (RuntimeException e) {
            networkCallback = null; // auto-retry is a nicety; never crash for it
        }
    }

    private void unregisterConnectivityCallback() {
        if (connectivityManager != null && networkCallback != null) {
            try {
                connectivityManager.unregisterNetworkCallback(networkCallback);
            } catch (RuntimeException ignored) {
            }
        }
        networkCallback = null;
    }

    // ------------------------------------------------------------------ back button

    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        if (customView != null) {
            hideCustomView();
            return;
        }
        if (webView.canGoBack()) {
            if (isErrorShowing()) {
                hideErrorView();
                mainFrameError = false;
            }
            webView.goBack();
            return;
        }
        long now = SystemClock.elapsedRealtime();
        if (now - lastBackPress < BACK_EXIT_WINDOW_MS) {
            super.onBackPressed();
        } else {
            lastBackPress = now;
            Toast.makeText(this, R.string.press_back_again, Toast.LENGTH_SHORT).show();
        }
    }

    // ------------------------------------------------------------------ fullscreen video

    @SuppressWarnings("deprecation")
    private void showCustomView(View view, WebChromeClient.CustomViewCallback callback) {
        if (customView != null) {
            callback.onCustomViewHidden();
            return;
        }
        customView = view;
        customViewCallback = callback;
        orientationBeforeFullscreen = getRequestedOrientation();
        ViewGroup decor = (ViewGroup) getWindow().getDecorView();
        view.setBackgroundColor(Color.BLACK);
        decor.addView(view, new FrameLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        systemUiBeforeFullscreen = decor.getSystemUiVisibility();
        decor.setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN
                | View.SYSTEM_UI_FLAG_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY
                | View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN
                | View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION
                | View.SYSTEM_UI_FLAG_LAYOUT_STABLE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setRequestedOrientation(ActivityInfo.SCREEN_ORIENTATION_SENSOR);
    }

    @SuppressWarnings("deprecation")
    private void hideCustomView() {
        if (customView == null) return;
        ViewGroup decor = (ViewGroup) getWindow().getDecorView();
        decor.removeView(customView);
        decor.setSystemUiVisibility(systemUiBeforeFullscreen);
        getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        setRequestedOrientation(orientationBeforeFullscreen);
        customView = null;
        if (customViewCallback != null) {
            customViewCallback.onCustomViewHidden();
            customViewCallback = null;
        }
    }

    // ------------------------------------------------------------------ file upload

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE_CHOOSER) {
            if (filePathCallback != null) {
                Uri[] result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
                filePathCallback.onReceiveValue(result); // null on cancel
                filePathCallback = null;
            }
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    // ------------------------------------------------------------------ downloads

    private void onDownloadRequested(String url, String userAgent, String contentDisposition,
                                     String mimeType, long contentLength) {
        Uri uri = Uri.parse(url);
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (!scheme.equals("https") && !scheme.equals("http")) {
            // blob:/data: downloads cannot go through DownloadManager.
            Toast.makeText(this, R.string.download_failed, Toast.LENGTH_SHORT).show();
            return;
        }
        PendingDownload dl = new PendingDownload(url, userAgent, contentDisposition, mimeType);
        if (Build.VERSION.SDK_INT >= 23 && Build.VERSION.SDK_INT <= 28
                && checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE)
                != PackageManager.PERMISSION_GRANTED) {
            pendingDownload = dl;
            requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_STORAGE);
            return;
        }
        startDownload(dl);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode == REQ_STORAGE) {
            PendingDownload dl = pendingDownload;
            pendingDownload = null;
            if (dl == null) return;
            if (grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED) {
                startDownload(dl);
            } else {
                openExternally(Uri.parse(dl.url)); // let the browser download it
            }
            return;
        }
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    }

    private void startDownload(PendingDownload dl) {
        try {
            String fileName = URLUtil.guessFileName(dl.url, dl.contentDisposition, dl.mimeType);
            DownloadManager.Request req = new DownloadManager.Request(Uri.parse(dl.url));
            String cookie = CookieManager.getInstance().getCookie(dl.url);
            if (cookie != null) req.addRequestHeader("Cookie", cookie);
            req.addRequestHeader("User-Agent",
                    dl.userAgent != null ? dl.userAgent : webView.getSettings().getUserAgentString());
            if (dl.mimeType != null) req.setMimeType(dl.mimeType);
            req.setTitle(fileName);
            req.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
            req.setDestinationInExternalPublicDir(Environment.DIRECTORY_DOWNLOADS, fileName);
            DownloadManager dm = (DownloadManager) getSystemService(Context.DOWNLOAD_SERVICE);
            if (dm == null) throw new IllegalStateException("no DownloadManager");
            dm.enqueue(req);
            Toast.makeText(this, R.string.downloading, Toast.LENGTH_SHORT).show();
        } catch (RuntimeException e) {
            Toast.makeText(this, R.string.download_failed, Toast.LENGTH_SHORT).show();
        }
    }

    // ------------------------------------------------------------------ clients

    private final class QimmahWebViewClient extends WebViewClient {

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            // Sub-frame navigations (YouTube embeds etc.) always stay inside their iframe.
            if (!request.isForMainFrame()) return false;
            return handleTopLevelNavigation(request.getUrl());
        }

        @Override
        @SuppressWarnings("deprecation")
        public boolean shouldOverrideUrlLoading(WebView view, String url) {
            // Only called on API < 24.
            Uri uri = Uri.parse(url);
            if (isEmbedPlayer(uri)) return false;
            return handleTopLevelNavigation(uri);
        }

        @Override
        public void onPageStarted(WebView view, String url, Bitmap favicon) {
            mainFrameError = false;
            progressBar.setProgress(0);
            progressBar.setVisibility(View.VISIBLE);
        }

        @Override
        public void onPageFinished(WebView view, String url) {
            progressBar.setVisibility(View.GONE);
            if (!mainFrameError && url != null && !url.startsWith("about:")) {
                failedUrl = null;
                hideErrorView();
                view.setBackgroundColor(Color.WHITE);
                if (clearHistoryOnNextFinish) {
                    clearHistoryOnNextFinish = false;
                    view.clearHistory();
                }
            }
            CookieManager.getInstance().flush();
        }

        @Override
        public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
            // API 23+. Not calling super, so the legacy overload below is not invoked too.
            if (request.isForMainFrame()) {
                showErrorView(request.getUrl().toString());
            }
        }

        @Override
        @SuppressWarnings("deprecation")
        public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
            // API 21-22 only (main frame errors).
            if (Build.VERSION.SDK_INT < 23) {
                showErrorView(failingUrl);
            }
        }

        @Override
        public void onReceivedHttpError(WebView view, WebResourceRequest request,
                                        WebResourceResponse errorResponse) {
            if (request.isForMainFrame() && errorResponse.getStatusCode() >= 500) {
                showErrorView(request.getUrl().toString());
            }
        }

        @Override
        @SuppressLint("WebViewClientOnReceivedSslError")
        public void onReceivedSslError(WebView view, SslErrorHandler handler, SslError error) {
            handler.cancel(); // never proceed past an invalid certificate
            String url = error.getUrl();
            String current = view.getUrl();
            if (url != null && (current == null || url.equals(current) || isInternal(Uri.parse(url)))) {
                showErrorView(url);
            }
        }
    }

    private final class QimmahChromeClient extends WebChromeClient {

        @Override
        public void onProgressChanged(WebView view, int newProgress) {
            progressBar.setProgress(newProgress);
            progressBar.setVisibility(newProgress < 100 ? View.VISIBLE : View.GONE);
        }

        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback,
                                         FileChooserParams params) {
            if (filePathCallback != null) {
                filePathCallback.onReceiveValue(null);
            }
            filePathCallback = callback;
            Intent intent;
            try {
                intent = params.createIntent();
                intent.addCategory(Intent.CATEGORY_OPENABLE);
                String[] mimeTypes = acceptToMimeTypes(params.getAcceptTypes());
                if (mimeTypes.length == 0) {
                    intent.setType("*/*");
                } else if (mimeTypes.length == 1) {
                    intent.setType(mimeTypes[0]);
                } else {
                    intent.setType("*/*");
                    intent.putExtra(Intent.EXTRA_MIME_TYPES, mimeTypes);
                }
                startActivityForResult(Intent.createChooser(intent, params.getTitle()), REQ_FILE_CHOOSER);
            } catch (ActivityNotFoundException | IllegalArgumentException e) {
                filePathCallback = null;
                callback.onReceiveValue(null);
                Toast.makeText(MainActivity.this, R.string.no_file_picker, Toast.LENGTH_SHORT).show();
                return true;
            }
            return true;
        }

        /** Turns accept="audio/*,video/*,.pdf" into MIME types the picker understands. */
        private String[] acceptToMimeTypes(String[] accept) {
            java.util.LinkedHashSet<String> out = new java.util.LinkedHashSet<>();
            if (accept != null) {
                for (String entry : accept) {
                    if (entry == null) continue;
                    for (String a : entry.split(",")) {
                        a = a.trim().toLowerCase(Locale.ROOT);
                        if (a.isEmpty()) continue;
                        if (a.startsWith(".")) {
                            String m = android.webkit.MimeTypeMap.getSingleton()
                                    .getMimeTypeFromExtension(a.substring(1));
                            if (m != null) out.add(m);
                        } else if (a.contains("/")) {
                            out.add(a);
                        }
                    }
                }
            }
            return out.toArray(new String[0]);
        }

        @Override
        public void onShowCustomView(View view, CustomViewCallback callback) {
            showCustomView(view, callback);
        }

        @Override
        public void onHideCustomView() {
            hideCustomView();
        }

        @Override
        public Bitmap getDefaultVideoPoster() {
            // Avoids the grey "play" placeholder (and a null-bitmap crash on some WebViews).
            return Bitmap.createBitmap(1, 1, Bitmap.Config.ARGB_8888);
        }
    }
}

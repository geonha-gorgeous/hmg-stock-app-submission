package tech.donda.pleos;

import android.app.Activity;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.InputDevice;
import android.view.KeyEvent;
import android.view.MotionEvent;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.window.OnBackInvokedDispatcher;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Locale;
import java.util.UUID;

/** Bundled prototype host. Actual Pleos RotaryService delivery requires platform testing. */
public final class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private static final String HOME = "https://" + HOST + "/index.html";
    private WebView webView;
    private boolean pageReady;
    private final String session = "android-offline-demo-" + UUID.randomUUID();
    private float rotaryRemainder;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setSupportMultipleWindows(false);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        webView.addJavascriptInterface(new NativeBridge(), "PleosNative");
        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override public void onPageStarted(WebView view, String url, Bitmap favicon) { pageReady = false; }
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                // Do not give external content the app's JavaScript bridge.
                return !isLocal(request.getUrl());
            }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if (!isLocal(uri)) return response(403, "Forbidden", "text/plain", "External requests are disabled.");
                String path = uri.getPath();
                if ("/api/status".equals(path) && "GET".equals(request.getMethod())) {
                    return response(200, "OK", "application/json", "{\"provider\":\"demo\",\"environment\":\"paper\",\"configured\":false,\"missing\":[],\"session\":\"" + session + "\"}");
                }
                if (path != null && path.startsWith("/api/")) {
                    return response(503, "Service Unavailable", "application/json", "{\"error\":{\"code\":\"NOT_CONFIGURED\",\"message\":\"APK 예시 데이터 모드입니다. 증권사 서버를 연결하지 않았습니다.\"}}");
                }
                if (path == null || path.equals("/")) path = "/index.html";
                if (!"GET".equals(request.getMethod()) || path.contains("..") || path.contains("\\")) return response(404, "Not Found", "text/plain", "Not found");
                try {
                    return new WebResourceResponse(mime(path), "UTF-8", 200, "OK", Collections.singletonMap("X-Content-Type-Options", "nosniff"), getAssets().open("web" + path));
                } catch (IOException error) {
                    return response(404, "Not Found", "text/plain", "Bundled asset not found");
                }
            }
            @Override public void onPageFinished(WebView view, String url) {
                pageReady = HOME.equals(url);
                view.requestFocus();
            }
        });
        setContentView(webView);
        webView.loadUrl(HOME);
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::sendBack);
    }

    private static boolean isLocal(Uri uri) { return "https".equals(uri.getScheme()) && HOST.equals(uri.getHost()) && uri.getPort() == -1; }
    private static WebResourceResponse response(int status, String reason, String mime, String body) {
        return new WebResourceResponse(mime, "UTF-8", status, reason, Collections.singletonMap("Cache-Control", "no-store"), new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8)));
    }
    private static String mime(String path) {
        String lower = path.toLowerCase(Locale.ROOT);
        if (lower.endsWith(".html")) return "text/html";
        if (lower.endsWith(".js")) return "application/javascript";
        if (lower.endsWith(".css")) return "text/css";
        if (lower.endsWith(".json")) return "application/json";
        if (lower.endsWith(".svg")) return "image/svg+xml";
        if (lower.endsWith(".png")) return "image/png";
        if (lower.endsWith(".woff2")) return "font/woff2";
        return "application/octet-stream";
    }

    private void sendAction(String action) {
        if (!pageReady) return;
        // Actions originate from the closed mapping below, never from arbitrary URLs.
        webView.evaluateJavascript("window.dispatchEvent(new CustomEvent('pleos-ccp-input',{detail:{action:'" + action + "',source:'android'}}));", null);
    }
    private void sendBack() { if (pageReady) sendAction("back"); else moveTaskToBack(true); }
    @SuppressWarnings("deprecation")
    @Override public void onBackPressed() { sendBack(); }

    @Override public boolean dispatchKeyEvent(KeyEvent event) {
        String action;
        switch (event.getKeyCode()) {
            case KeyEvent.KEYCODE_DPAD_UP: action = "up"; break;
            case KeyEvent.KEYCODE_DPAD_DOWN: action = "down"; break;
            case KeyEvent.KEYCODE_DPAD_LEFT: action = "left"; break;
            case KeyEvent.KEYCODE_DPAD_RIGHT: action = "right"; break;
            case KeyEvent.KEYCODE_DPAD_CENTER:
            case KeyEvent.KEYCODE_ENTER:
            case KeyEvent.KEYCODE_NUMPAD_ENTER: action = "select"; break;
            case KeyEvent.KEYCODE_TAB: action = event.isShiftPressed() ? "previous" : "next"; break;
            case KeyEvent.KEYCODE_BACK:
            case KeyEvent.KEYCODE_ESCAPE: action = "back"; break;
            default: return super.dispatchKeyEvent(event);
        }
        // Consume both phases, emit only on DOWN; selection never repeats while held.
        if (event.getAction() == KeyEvent.ACTION_DOWN && (event.getRepeatCount() == 0 || (!action.equals("select") && !action.equals("back")))) {
            if (action.equals("back")) sendBack(); else sendAction(action);
        }
        return true;
    }

    @Override public boolean dispatchGenericMotionEvent(MotionEvent event) {
        if (event.getAction() == MotionEvent.ACTION_SCROLL && event.isFromSource(InputDevice.SOURCE_ROTARY_ENCODER)) {
            float delta = event.getAxisValue(MotionEvent.AXIS_SCROLL);
            if (delta == 0) delta = event.getAxisValue(MotionEvent.AXIS_VSCROLL);
            if (delta == 0) delta = event.getAxisValue(MotionEvent.AXIS_HSCROLL);
            // Android positive scroll is backward/up, negative is forward/down.
            rotaryRemainder = Math.max(-24, Math.min(24, rotaryRemainder + delta));
            int steps = Math.min(24, (int) Math.abs(rotaryRemainder));
            String action = rotaryRemainder < 0 ? "next" : "previous";
            if (steps > 0) {
                rotaryRemainder += rotaryRemainder < 0 ? steps : -steps;
                for (int i = 0; i < steps; i++) sendAction(action);
            }
            return true;
        }
        return super.dispatchGenericMotionEvent(event);
    }

    public final class NativeBridge {
        @JavascriptInterface public void hideApp() {
            runOnUiThread(() -> { if (pageReady && HOME.equals(webView.getUrl())) moveTaskToBack(true); });
        }
    }
    @Override protected void onDestroy() {
        pageReady = false;
        webView.removeJavascriptInterface("PleosNative");
        webView.destroy();
        super.onDestroy();
    }
}

package com.luduo.arcade;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.webkit.WebChromeClient;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

public class MainActivity extends Activity {
    private WebView webView;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureWindow();
        configureWebView();
        loadGame();
    }

    @SuppressLint("SetJavaScriptEnabled")
    private void configureWebView() {
        webView = new WebView(this);
        webView.setBackgroundColor(Color.rgb(9, 11, 16));
        webView.setOverScrollMode(View.OVER_SCROLL_NEVER);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setLoadWithOverviewMode(true);
        settings.setUseWideViewPort(true);
        settings.setBuiltInZoomControls(false);
        settings.setDisplayZoomControls(false);

        webView.setWebChromeClient(new WebChromeClient());
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public void onReceivedError(WebView view, int errorCode, String description, String failingUrl) {
                String url = getString(R.string.server_url);
                if (failingUrl == null || failingUrl.startsWith(url)) {
                    showOfflineScreen();
                }
            }
        });

        setContentView(webView);
    }

    private void configureWindow() {
        Window window = getWindow();
        window.setStatusBarColor(Color.rgb(9, 11, 16));
        window.setNavigationBarColor(Color.rgb(9, 11, 16));
        window.getDecorView().setSystemUiVisibility(0);
    }

    private void loadGame() {
        String url = getString(R.string.server_url);
        showLoadingScreen();
        webView.postDelayed(() -> webView.loadUrl(url), 350);
    }

    private void showLoadingScreen() {
        String html = "<!doctype html><html><head><meta name='viewport' content='width=device-width, initial-scale=1'>"
            + "<style>body{margin:0;background:#090b10;color:#f6f8ff;font-family:system-ui,-apple-system,Segoe UI,sans-serif;"
            + "display:grid;place-items:center;min-height:100vh;padding:24px;text-align:center}main{max-width:360px}"
            + ".mark{width:74px;height:74px;border-radius:18px;background:linear-gradient(135deg,#24d6ff,#6ef3a5);"
            + "margin:0 auto 18px;position:relative}.mark:before,.mark:after{content:'';position:absolute;top:18px;width:12px;"
            + "height:38px;border-radius:999px;background:#071015}.mark:before{left:22px}.mark:after{right:22px}"
            + "h1{font-size:34px;margin:0 0 10px}p{color:#9aa7bd;line-height:1.45}</style></head>"
            + "<body><main><div class='mark'></div><h1>Luduo Arcade</h1><p>Conectando ao servidor online...</p></main></body></html>";
        webView.loadDataWithBaseURL(getString(R.string.server_url), html, "text/html", "UTF-8", null);
    }

    private void showOfflineScreen() {
        String url = getString(R.string.server_url);
        String html = "<!doctype html><html><head><meta name='viewport' content='width=device-width, initial-scale=1'>"
            + "<style>body{margin:0;background:#090b10;color:#f6f8ff;font-family:system-ui,-apple-system,Segoe UI,sans-serif;"
            + "display:grid;place-items:center;min-height:100vh;padding:24px;text-align:center}main{max-width:360px}"
            + "h1{font-size:34px;margin:0 0 10px}p{color:#9aa7bd;line-height:1.45}"
            + "button{border:0;border-radius:8px;background:linear-gradient(135deg,#24d6ff,#6ef3a5);"
            + "color:#061015;font-weight:800;min-height:48px;padding:0 20px}</style></head>"
            + "<body><main><h1>Luduo Arcade</h1><p>Sem conexao com o servidor online. Verifique a internet ou aguarde o servidor acordar.</p>"
            + "<button onclick=\"location.href='" + url + "'\">Tentar de novo</button></main></body></html>";
        webView.loadDataWithBaseURL(url, html, "text/html", "UTF-8", null);
    }

    @Override
    public void onBackPressed() {
        if (webView != null && webView.canGoBack()) {
            webView.goBack();
            return;
        }
        super.onBackPressed();
    }
}

package com.luduo.arcade;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.net.ConnectivityManager;
import android.net.NetworkInfo;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowInsets;
import android.view.WindowInsetsController;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
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
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request != null && request.isForMainFrame()) {
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

        if (android.os.Build.VERSION.SDK_INT >= android.os.Build.VERSION_CODES.R) {
            WindowInsetsController controller = window.getInsetsController();
            if (controller != null) {
                controller.hide(WindowInsets.Type.statusBars());
            }
        } else {
            window.getDecorView().setSystemUiVisibility(View.SYSTEM_UI_FLAG_FULLSCREEN);
        }
    }

    private void loadGame() {
        String url = getString(R.string.server_url);
        if (isOnline()) {
            webView.loadUrl(url);
        } else {
            showOfflineScreen();
        }
    }

    private boolean isOnline() {
        ConnectivityManager manager = (ConnectivityManager) getSystemService(CONNECTIVITY_SERVICE);
        if (manager == null) return true;
        NetworkInfo networkInfo = manager.getActiveNetworkInfo();
        return networkInfo != null && networkInfo.isConnected();
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

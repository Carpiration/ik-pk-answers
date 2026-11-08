package app.answers.ikpk;

import android.app.Activity;
import android.content.Intent;
import android.graphics.Color;
import android.graphics.Insets;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.ConsoleMessage;
import android.webkit.JavascriptInterface;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

/**
 * Оболочка над сайтом (BuildInfo.APP_URL): новые ответы и исправления приходят с сайта без новой версии APK.
 * Сначала открывается start.html из assets: он переходит на сайт, а без сети показывает экран «Нет связи».
 * После первого открытия сайт кэширует себя (service worker) и дальше открывается и без интернета.
 */
public class MainActivity extends Activity {
    private static final String START_URL = "file:///android_asset/start.html";
    private static final int BG = Color.parseColor("#111317");

    private WebView web;

    static final class Bridge {
        @JavascriptInterface public String appUrl() { return BuildInfo.APP_URL; }
        @JavascriptInterface public String version() { return BuildInfo.VERSION_NAME; }
    }

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        web = new WebView(this);
        web.setBackgroundColor(BG);

        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowContentAccess(false);
        s.setUserAgentString(s.getUserAgentString() + " OtvetyApp/" + BuildInfo.VERSION_NAME);
        web.addJavascriptInterface(new Bridge(), "AnswersBridge");

        final String appHost = Uri.parse(BuildInfo.APP_URL).getHost();
        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                Uri uri = request.getUrl();
                if ("file".equals(uri.getScheme()) || appHost.equals(uri.getHost())) return false;
                // Внешние ссылки открываем в браузере, а не внутри приложения.
                try { startActivity(new Intent(Intent.ACTION_VIEW, uri)); } catch (Exception ignored) {}
                return true;
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                // Сайт не открылся и его еще нет в кэше — показываем свой экран с кнопкой «Повторить».
                if (request.isForMainFrame() && !"file".equals(request.getUrl().getScheme())) {
                    view.loadUrl(START_URL + "?offline=1");
                }
            }
        });

        // Ошибки страницы видны в `adb logcat -s Otvety`.
        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage m) {
                Log.i("Otvety", m.message() + " @" + m.lineNumber());
                return true;
            }
        });

        // Отступы от системных панелей задаем контейнеру: собственный padding WebView игнорирует.
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(BG);
        root.addView(web, new FrameLayout.LayoutParams(
                FrameLayout.LayoutParams.MATCH_PARENT, FrameLayout.LayoutParams.MATCH_PARENT));
        setupSystemBars(root);
        setContentView(root);

        if (savedInstanceState == null || web.restoreState(savedInstanceState) == null) {
            web.loadUrl(START_URL);
        }
    }

    /** С Android 11 рисуем под системными панелями сами и отступаем на их высоту и высоту клавиатуры. Тема темная — значки панелей светлые. */
    private void setupSystemBars(View root) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            getWindow().setDecorFitsSystemWindows(false);
            root.setOnApplyWindowInsetsListener((v, insets) -> {
                Insets i = insets.getInsets(WindowInsets.Type.systemBars()
                        | WindowInsets.Type.displayCutout()
                        | WindowInsets.Type.ime());
                v.setPadding(i.left, i.top, i.right, i.bottom);
                return WindowInsets.CONSUMED;
            });
        }
    }

    /** «Назад» сначала закрывает результаты поиска, затем возвращает к предыдущему экрану (window.appBack на сайте). */
    @Override
    @SuppressWarnings("deprecation")
    public void onBackPressed() {
        web.evaluateJavascript("typeof appBack === 'function' && appBack()", result -> {
            if (!"true".equals(result)) moveTaskToBack(true);
        });
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        web.saveState(outState);
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
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

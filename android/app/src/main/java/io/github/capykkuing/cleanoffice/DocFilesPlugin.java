package io.github.capykkuing.cleanoffice;

import android.app.Activity;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;

/**
 * 안드로이드 기본 파일 선택창(SAF)으로 문서를 열고, 같은 파일에 다시 저장한다.
 * 폰에 설치된 구글 드라이브·원드라이브·드롭박스 등도 선택창 안에 그대로 나오므로
 * 앱이 클라우드에 따로 로그인할 필요가 없다.
 */
@CapacitorPlugin(name = "DocFiles")
public class DocFilesPlugin extends Plugin {

    private static final long MAX_BYTES = 60L * 1024 * 1024;
    private boolean launchHandled = false;

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        if (!isViewIntent(intent)) return;
        try {
            // 앱이 막 켜지는 중이면 화면 쪽이 아직 듣고 있지 않을 수 있어 보관해 둠
            notifyListeners("fileOpened", describe(intentUri(intent), false, true), true);
        } catch (Exception e) {
            JSObject err = new JSObject();
            err.put("error", e.getMessage());
            notifyListeners("fileOpened", err, true);
        }
    }

    // 다른 앱에서 "클린오피스로 열기"로 실행됐을 때 그 파일
    @PluginMethod
    public void getLaunchFile(PluginCall call) {
        // 앱이 꺼져 있다가 파일로 실행된 경우: 실행 인텐트를 한 번만 처리
        Intent intent = getActivity().getIntent();
        if (launchHandled || !isViewIntent(intent)) {
            call.resolve(new JSObject());
            return;
        }
        launchHandled = true;
        try {
            call.resolve(describe(intentUri(intent), false, true));
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    @PluginMethod
    public void open(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType("*/*");
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, i, "openResult");
    }

    @ActivityCallback
    private void openResult(PluginCall call, ActivityResult result) {
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            call.reject("취소됨", "CANCELLED");
            return;
        }
        Uri uri = data.getData();
        boolean writable = keepPermission(uri);
        try {
            call.resolve(describe(uri, writable, true));
        } catch (Exception e) {
            call.reject(e.getMessage());
        }
    }

    // 최근 문서 다시 열기: 저장해 둔 주소로 최신 내용을 읽음
    @PluginMethod
    public void read(PluginCall call) {
        String uri = call.getString("uri");
        if (uri == null) {
            call.reject("uri 없음");
            return;
        }
        try {
            call.resolve(describe(Uri.parse(uri), canWrite(Uri.parse(uri)), true));
        } catch (Exception e) {
            call.reject("파일에 접근할 수 없습니다 (옮겨졌거나 지워졌을 수 있음)");
        }
    }

    // 연 파일에 그대로 덮어쓰기
    @PluginMethod
    public void write(PluginCall call) {
        String uri = call.getString("uri");
        String b64 = call.getString("data");
        if (uri == null || b64 == null) {
            call.reject("uri/data 없음");
            return;
        }
        try {
            writeBytes(Uri.parse(uri), Base64.decode(b64, Base64.NO_WRAP));
            call.resolve();
        } catch (Exception e) {
            call.reject("이 위치에는 바로 저장할 수 없습니다: " + e.getMessage(), "NOT_WRITABLE");
        }
    }

    // 다른 이름으로 저장: 사용자가 위치(기기·드라이브 등)와 이름을 고름
    @PluginMethod
    public void create(PluginCall call) {
        Intent i = new Intent(Intent.ACTION_CREATE_DOCUMENT);
        i.addCategory(Intent.CATEGORY_OPENABLE);
        i.setType(call.getString("mime", "application/octet-stream"));
        i.putExtra(Intent.EXTRA_TITLE, call.getString("name", "문서"));
        i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, i, "createResult");
    }

    @ActivityCallback
    private void createResult(PluginCall call, ActivityResult result) {
        Intent data = result.getData();
        if (result.getResultCode() != Activity.RESULT_OK || data == null || data.getData() == null) {
            call.reject("취소됨", "CANCELLED");
            return;
        }
        Uri uri = data.getData();
        try {
            writeBytes(uri, Base64.decode(call.getString("data", ""), Base64.NO_WRAP));
            boolean writable = keepPermission(uri);
            call.resolve(describe(uri, writable, false));
        } catch (Exception e) {
            call.reject("저장하지 못했습니다: " + e.getMessage());
        }
    }

    // ---------- 내부 ----------
    private static boolean isViewIntent(Intent intent) {
        if (intent == null) return false;
        String a = intent.getAction();
        return (Intent.ACTION_VIEW.equals(a) && intent.getData() != null)
            || (Intent.ACTION_SEND.equals(a) && intent.getParcelableExtra(Intent.EXTRA_STREAM) != null);
    }

    private static Uri intentUri(Intent intent) {
        if (Intent.ACTION_SEND.equals(intent.getAction())) return intent.getParcelableExtra(Intent.EXTRA_STREAM);
        return intent.getData();
    }

    private boolean keepPermission(Uri uri) {
        ContentResolver cr = getContext().getContentResolver();
        try {
            cr.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
            return true;
        } catch (Exception e) {
            try {
                cr.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (Exception ignored) {
                // 일부 앱은 영구 권한을 주지 않음 → 이번 실행 동안만 사용
            }
            return false;
        }
    }

    private boolean canWrite(Uri uri) {
        for (android.content.UriPermission p : getContext().getContentResolver().getPersistedUriPermissions()) {
            if (p.getUri().equals(uri) && p.isWritePermission()) return true;
        }
        return false;
    }

    private JSObject describe(Uri uri, boolean writable, boolean withData) throws Exception {
        ContentResolver cr = getContext().getContentResolver();
        String name = "문서";
        long size = -1;
        try (Cursor c = cr.query(uri, null, null, null, null)) {
            if (c != null && c.moveToFirst()) {
                int n = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                int s = c.getColumnIndex(OpenableColumns.SIZE);
                if (n >= 0 && !c.isNull(n)) name = c.getString(n);
                if (s >= 0 && !c.isNull(s)) size = c.getLong(s);
            }
        }
        if (size > MAX_BYTES) throw new Exception("파일이 너무 큽니다 (60MB 초과)");
        JSObject o = new JSObject();
        o.put("uri", uri.toString());
        o.put("name", name);
        o.put("writable", writable);
        if (withData) {
            byte[] bytes = readBytes(uri);
            o.put("size", bytes.length);
            o.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP));
        }
        return o;
    }

    private byte[] readBytes(Uri uri) throws Exception {
        try (InputStream in = getContext().getContentResolver().openInputStream(uri); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            if (in == null) throw new Exception("파일을 열 수 없습니다");
            byte[] buf = new byte[64 * 1024];
            int n;
            long total = 0;
            while ((n = in.read(buf)) > 0) {
                total += n;
                if (total > MAX_BYTES) throw new Exception("파일이 너무 큽니다 (60MB 초과)");
                out.write(buf, 0, n);
            }
            return out.toByteArray();
        }
    }

    private void writeBytes(Uri uri, byte[] bytes) throws Exception {
        try (OutputStream out = getContext().getContentResolver().openOutputStream(uri, "wt")) {
            if (out == null) throw new Exception("저장 위치를 열 수 없습니다");
            out.write(bytes);
        }
    }
}

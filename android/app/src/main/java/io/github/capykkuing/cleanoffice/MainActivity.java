package io.github.capykkuing.cleanoffice;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(DocFilesPlugin.class);
        super.onCreate(savedInstanceState);
    }
}

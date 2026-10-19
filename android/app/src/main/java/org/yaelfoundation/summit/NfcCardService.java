package org.yaelfoundation.summit;

import android.nfc.NdefMessage;
import android.nfc.NdefRecord;
import android.nfc.cardemulation.HostApduService;
import android.os.Bundle;

import java.util.Arrays;

/**
 * Makes the phone behave like an NFC tag (NFC Forum Type 4) that holds one link: the
 * principal's meet link. Another phone held against it reads the link the same way it reads
 * any NFC sticker, and opens it: in the Yael Summit app if installed, otherwise in the browser.
 * Answers only while "Meet in person" is open in the app (see MainActivity).
 */
public class NfcCardService extends HostApduService {
    private static volatile byte[] ndefFile; // 2-byte length + NDEF message, or null when not sharing

    private static final byte[] AID = {(byte) 0xD2, 0x76, 0x00, 0x00, (byte) 0x85, 0x01, 0x01};
    private static final byte[] OK = {(byte) 0x90, 0x00};
    private static final byte[] NOT_FOUND = {(byte) 0x6A, (byte) 0x82};
    private static final byte[] WRONG_OFFSET = {(byte) 0x6B, 0x00};
    private static final byte[] UNKNOWN = {(byte) 0x6D, 0x00};
    private static final int CC_ID = 0xE103, NDEF_ID = 0xE104, MAX_NDEF = 0x0800;

    // Capability container: version 2.0, max read 0x3B, max write 0x34, NDEF file E104, read-only.
    private static final byte[] CC = {
        0x00, 0x0F, 0x20, 0x00, 0x3B, 0x00, 0x34,
        0x04, 0x06, (byte) 0xE1, 0x04, (byte) (MAX_NDEF >> 8), (byte) (MAX_NDEF & 0xFF), 0x00, (byte) 0xFF
    };

    private boolean appSelected;
    private byte[] selected;

    /** Starts sharing a link (null stops). */
    static void share(String url) {
        if (url == null) { ndefFile = null; return; }
        byte[] msg = new NdefMessage(NdefRecord.createUri(url)).toByteArray();
        if (msg.length + 2 > MAX_NDEF) { ndefFile = null; return; }
        byte[] file = new byte[msg.length + 2];
        file[0] = (byte) (msg.length >> 8);
        file[1] = (byte) (msg.length & 0xFF);
        System.arraycopy(msg, 0, file, 2, msg.length);
        ndefFile = file;
    }

    static boolean sharing() { return ndefFile != null; }

    @Override
    public byte[] processCommandApdu(byte[] apdu, Bundle extras) {
        byte[] file = ndefFile;
        if (file == null || apdu == null || apdu.length < 4) return NOT_FOUND;
        int ins = apdu[1] & 0xFF, p1 = apdu[2] & 0xFF, p2 = apdu[3] & 0xFF;

        if (ins == 0xA4) { // SELECT
            int lc = apdu.length > 4 ? apdu[4] & 0xFF : 0;
            if (apdu.length < 5 + lc) return NOT_FOUND;
            byte[] data = Arrays.copyOfRange(apdu, 5, 5 + lc);
            if (p1 == 0x04) { // by application name
                appSelected = Arrays.equals(data, AID);
                selected = null;
                return appSelected ? OK : NOT_FOUND;
            }
            if (p1 == 0x00 && appSelected && lc == 2) { // by file id
                int id = ((data[0] & 0xFF) << 8) | (data[1] & 0xFF);
                if (id == CC_ID) { selected = CC; return OK; }
                if (id == NDEF_ID) { selected = file; return OK; }
            }
            return NOT_FOUND;
        }

        if (ins == 0xB0 && selected != null) { // READ BINARY
            int offset = (p1 << 8) | p2;
            int le = apdu.length > 4 ? apdu[4] & 0xFF : 0;
            if (le == 0) le = 256;
            if (offset > selected.length) return WRONG_OFFSET;
            int end = Math.min(selected.length, offset + le);
            byte[] out = new byte[end - offset + 2];
            System.arraycopy(selected, offset, out, 0, end - offset);
            out[out.length - 2] = (byte) 0x90;
            out[out.length - 1] = 0x00;
            return out;
        }
        return UNKNOWN;
    }

    @Override
    public void onDeactivated(int reason) {
        appSelected = false;
        selected = null;
    }
}

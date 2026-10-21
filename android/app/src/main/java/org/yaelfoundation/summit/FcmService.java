package org.yaelfoundation.summit;

import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;

/**
 * Instant notifications. The site asks Firebase to wake this app when something happens; the wake-up
 * carries no content, so the app reads what's new from the site itself (NotifyJob.check) and shows it.
 */
public class FcmService extends FirebaseMessagingService {
    @Override
    public void onMessageReceived(RemoteMessage message) {
        try { NotifyJob.check(getApplicationContext()); } catch (Exception ignored) { }
    }

    /** A new Firebase token for this install: the site picks it up the next time the app is open. */
    @Override
    public void onNewToken(String token) {
        getSharedPreferences("notify", MODE_PRIVATE).edit().putString("fcm", token).apply();
    }
}

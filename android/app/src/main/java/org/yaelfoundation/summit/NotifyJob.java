package org.yaelfoundation.summit;

import android.Manifest;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.webkit.CookieManager;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

/**
 * Phone notifications for the Android app. About every 15 minutes (Android decides the exact
 * timing to save battery) the app asks the site what's new for the signed-in principal
 * (/api/notifications) and shows each new item: connection requests, accepted connections,
 * messages and replies on the board. No third-party push service is involved.
 */
public class NotifyJob extends JobService {
    private static final int JOB_ID = 7701;
    static final String CHANNEL = "activity";
    static volatile boolean appOnScreen;

    /** Called when the app starts: keeps the periodic check scheduled. */
    static void schedule(Context ctx) {
        JobScheduler js = ctx.getSystemService(JobScheduler.class);
        if (js == null || js.getPendingJob(JOB_ID) != null) return;
        JobInfo job = new JobInfo.Builder(JOB_ID, new ComponentName(ctx, NotifyJob.class))
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setPeriodic(15 * 60 * 1000L)
            .setPersisted(true)
            .build();
        js.schedule(job);
    }

    static void createChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Your constellation", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Connection requests, messages and replies");
        ch.enableLights(true);
        ch.setLightColor(Color.parseColor("#E3B55A"));
        ctx.getSystemService(NotificationManager.class).createNotificationChannel(ch);
    }

    static boolean allowed(Context ctx) {
        if (Build.VERSION.SDK_INT >= 33 && ctx.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) return false;
        return ctx.getSystemService(NotificationManager.class).areNotificationsEnabled();
    }

    @Override
    public boolean onStartJob(JobParameters params) {
        new Thread(() -> {
            try { check(getApplicationContext()); } catch (Exception ignored) { }
            jobFinished(params, false);
        }).start();
        return true;
    }

    @Override
    public boolean onStopJob(JobParameters params) { return true; }

    /** Reads the sign-in cookie (the WebView's cookie store lives on the main thread). */
    private static String cookie() throws InterruptedException {
        final String[] out = new String[1];
        CountDownLatch done = new CountDownLatch(1);
        new Handler(Looper.getMainLooper()).post(() -> {
            try { out[0] = CookieManager.getInstance().getCookie(BuildConfig.SITE_URL); } catch (Exception ignored) { }
            done.countDown();
        });
        done.await(10, TimeUnit.SECONDS);
        return out[0];
    }

    static void check(Context ctx) throws Exception {
        String cookie = cookie();
        if (cookie == null || !cookie.contains("ys=")) return;   // not signed in
        SharedPreferences prefs = ctx.getSharedPreferences("notify", MODE_PRIVATE);
        long last = prefs.getLong("last", -1);

        HttpURLConnection c = (HttpURLConnection) new URL(BuildConfig.SITE_URL + "/api/notifications?after=" + Math.max(0, last)).openConnection();
        c.setRequestProperty("Cookie", cookie);
        c.setRequestProperty("Accept", "application/json");
        c.setConnectTimeout(15000);
        c.setReadTimeout(15000);
        if (c.getResponseCode() != 200) return;
        JSONObject res;
        try (InputStream in = c.getInputStream()) {
            ByteArrayOutputStream buf = new ByteArrayOutputStream();
            byte[] b = new byte[8192];
            for (int n; (n = in.read(b)) > 0; ) buf.write(b, 0, n);
            res = new JSONObject(buf.toString("UTF-8"));
        }
        long latest = res.optLong("latest", 0);
        if (last < 0) { prefs.edit().putLong("last", latest).apply(); return; } // first run: start from now
        JSONArray list = res.optJSONArray("notifications");
        if (list != null && !appOnScreen && allowed(ctx)) {
            createChannel(ctx);
            NotificationManager nm = ctx.getSystemService(NotificationManager.class);
            for (int i = list.length() - 1; i >= 0; i--) {   // oldest first
                JSONObject n = list.getJSONObject(i);
                if (n.optLong("id") <= last) continue;
                nm.notify((int) n.optLong("id"), build(ctx, n));
            }
        }
        if (latest > last) prefs.edit().putLong("last", latest).apply();
    }

    private static Notification build(Context ctx, JSONObject n) {
        Uri page = Uri.parse(BuildConfig.SITE_URL + "/" + n.optString("url", "#/"));
        Intent open = new Intent(Intent.ACTION_VIEW, page, ctx, MainActivity.class).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        PendingIntent tap = PendingIntent.getActivity(ctx, (int) n.optLong("id"), open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        Notification.Builder b = Build.VERSION.SDK_INT >= 26 ? new Notification.Builder(ctx, CHANNEL) : new Notification.Builder(ctx);
        b.setSmallIcon(R.drawable.ic_notify)
            .setColor(Color.parseColor("#E3B55A"))
            .setContentTitle(n.optString("title"))
            .setContentText(n.optString("body"))
            .setStyle(new Notification.BigTextStyle().bigText(n.optString("body")))
            .setWhen(n.optLong("created_at", System.currentTimeMillis()))
            .setShowWhen(true)
            .setAutoCancel(true)
            .setContentIntent(tap);
        if (Build.VERSION.SDK_INT < 26) b.setPriority(Notification.PRIORITY_HIGH).setDefaults(Notification.DEFAULT_ALL);
        return b.build();
    }
}

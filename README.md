# Coursework Planner

A personal planner for Canvas assignment deadlines that you can install on your phone. It shows statuses, notes, a calendar and a weekly workload chart, and emails you deadline reminders.

This repository holds only the app itself. Your assignments, the private Canvas feed link and the access key all live in your own Google account, so nothing personal is published here.

## Setup (about 20 minutes)

### 1. Make the Google Sheet and script

1. Go to [sheets.new](https://sheets.new) and name the sheet **Coursework Planner**.
2. Choose **Extensions → Apps Script**.
3. Delete what's in the editor, paste in everything from `Code.gs` (the file that came with this folder, not in this repository), and press **Save** (💾).
4. In the toolbar, choose **setup** from the function dropdown and press **Run**.
5. Google asks for permission. Choose your account, then **Advanced → Go to Coursework Planner (unsafe) → Allow**. The "unsafe" warning appears because this is your own script and Google hasn't reviewed it. It only reads your sheet and Canvas feed, and only sends emails to you.
6. When it finishes, open the **Execution log** at the bottom. Copy the line **YOUR ACCESS KEY** somewhere for a minute.

### 2. Publish the script as a web app

1. Choose **Deploy → New deployment**.
2. Click the gear ⚙ next to "Select type" and choose **Web app**.
3. Set **Execute as: Me** and **Who has access: Anyone**. The app still needs your access key, so other people can't read your data.
4. Press **Deploy** and copy the **Web app URL** (it ends in `/exec`).

### 3. Put the app on GitHub Pages

1. Sign in at [github.com](https://github.com) (or create a free account).
2. Click **+ → New repository**, name it `coursework-planner`, keep it **Public**, and click **Create repository**.
3. Click **uploading an existing file**. Drag in every file from this folder: `index.html`, `manifest.webmanifest`, `sw.js`, `README.md` and the four `.png` icons. Then click **Commit changes**.
4. Go to **Settings → Pages**. Under "Branch" choose **main** and **/ (root)**, then click **Save**.
5. After a minute or two the page shows your address, something like `https://YOUR-USERNAME.github.io/coursework-planner/`.

### 4. Connect and install

1. Open that address on your phone.
2. Paste the **Web app URL** and **Access key**, then tap **Connect**. Your assignments appear.
3. Install it:
   - **iPhone (Safari):** tap Share → **Add to Home Screen**.
   - **Android (Chrome):** tap ⋮ → **Install app** (or **Add to Home screen**).
4. Do the same on your laptop if you like. Each device needs the URL and key once.

### 5. Finish the reminders

1. Back in Apps Script, put your GitHub Pages address in `PLANNER_URL` near the top of the code, so reminder emails have an "Open your planner" button, then press **Save**.
2. Choose **testEmail** from the function dropdown and press **Run**. A sample reminder arrives in your inbox within a minute.

## How it works

- **Every morning at 7am**, the script checks your Canvas feed. New assignments are added and changed dates are updated. Your statuses and notes are never touched.
- **Reminder emails** go out 7, 3 and 1 days before each deadline and on the day, plus up to 3 days after if you miss one. Nothing is sent on days with nothing to report. Submitted and hidden assignments are skipped.
- **Sync → Check Canvas now** in the app runs the check straight away.
- Your data is in the **Assignments** tab of the sheet, so you can also look at or edit it there.

## Changing things later

- **Reminder days or time:** edit `REMINDER_DAYS`, `OVERDUE_DAYS` or `DAILY_HOUR` at the top of `Code.gs`, save, then run **setup** again. It won't duplicate or reset anything.
- **New Canvas feed link:** replace `CANVAS_FEED_URL`, then save.
- **After editing the script's web app code:** choose **Deploy → Manage deployments → ✏️ → Version: New version → Deploy**. That keeps the same URL.
- **Updating the app:** upload the changed files to the repository again. Phones pick up the new version the next time the app is opened with signal.

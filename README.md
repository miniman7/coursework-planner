# Coursework Planner

A personal planner for Canvas assignment deadlines that you can install on your phone. It shows statuses, notes, a calendar and a weekly workload chart, and emails you reminders 7, 3 and 1 days before each deadline.

**Want your own? Follow the setup guide: https://miniman7.github.io/coursework-planner/setup.html**

## How it works

- **The app** (`index.html`) is hosted here on GitHub Pages and shared by everyone.
- **Your data** lives in your own Google account. `Code.gs` is a Google Apps Script that each person copies into their own account. It stores assignments in a Google Sheet in their Drive, checks their Canvas calendar feed every morning, and sends reminder emails from their own Gmail.
- Nobody's assignments, Canvas link or access key are stored in this repository.

## Files

| File | What it is |
| --- | --- |
| `index.html` | The planner app |
| `setup.html` | Step-by-step setup guide for new users |
| `Code.gs` | The Google Apps Script each user copies into their account |
| `manifest.webmanifest`, `sw.js`, `*.png` | Lets the app install to a home screen and work offline |

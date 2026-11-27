# Making the Vaultisse videos (instructions for Claude Code)

This file is the playbook for **Claude Code**. When the owner says something like *"make a video about the admin panel setup"* or
*"make the release video for v1.3.9"*, follow this file from top to bottom. It produces a finished video, its YouTube texts,
subtitles in four languages and a cover image, and **uploads it to the owner's YouTube channel** with the settings below.

> **Run it on the owner's computer.** The videos, the subtitles and the YouTube credentials live on the owner's machine, never in this
> repository and never in a cloud session. If this session runs in the cloud, say so and stop: ask the owner to start Claude Code on their
> own computer in a clone of the repository (or to attach it), then continue there.

---

## 1. What a video looks like

| Part | What it is |
|---|---|
| **Intro (about 30 s)** | Looks like a **PowerPoint**: a nice full-screen image, the video title, the version, a short introduction of what the video covers (3 to 5 slides, with the narration of the introduction). |
| **Main video** | Looks like a **desktop application**: a soft, nice **background**, and **centered** on it the web page in a window with **rounded corners** and a shadow, as if it were a native app. 1920x1080, 30 fps. |
| **Outro (5 to 8 s)** | One slide: what to watch next, "subscribe", the project address and the version. |
| **Subtitles** | **English, Spanish, Catalan and German**, each as a subtitle file *and* a plain transcript. |
| **Cover** | A 1280x720 image for YouTube. |

### The length rule: 3 minutes at most

**Every video is at most 3 minutes long, in total** (intro and outro included). This is a hard limit, not a target.

- A video is **a small chapter that explains one precise thing**, never a long tutorial. People search YouTube or Google for one precise
  question ("how to set up email in Vaultisse", "how to block an address in the admin panel") and must find a short video that answers exactly that, fast.
- Budget: intro about 20 to 30 s, **main content about 2 minutes**, outro 5 s. That is about **300 spoken words in all**, no more.
- If a topic does not fit in 3 minutes, **do not squeeze it and do not make it longer: split it into several videos** (a series, one precise thing each,
  linked in a playlist and in each description). Example: *"Set up the admin panel"* becomes *Start it*, *First sign-in and two-factor*, *Use the setup guide*, *Set up email*.
- One video, one question, one answer. No detours, no "by the way", no feature tours. If the title does not name the thing the video does, the video is too broad.

### Made to be found

The title, the first words of the narration, the description and the tags are written for **search**, so someone who types the question finds this video:

- The title says the exact task in the words people type, as a short phrase (see section 4): `𝗦𝗲𝘁𝘂𝗽: How to set up email (SMTP) in Vaultisse — v1.3.9`.
- The key phrase appears in the title, in the first sentence of the description, in the first sentence spoken, in a tag, and in the file names of the transcript.
- One video answers one query. Do not mix two topics in one title.

## 2. Where everything goes (outside the repository)

**Nothing generated is ever stored in the repository.** Videos are huge and credentials are secret.

- Output directory: `VIDEO_OUTPUT_DIR` (default `~/Vaultisse-Videos`). Read it from `~/.config/vaultisse-video/config.env`
  (template: [`config.example.env`](config.example.env)).
- **One folder per video**, named `<yyyy-mm-dd>_<slug>_v<version>`, for example `2026-11-27_admin-panel-setup_v1.3.9`:

```
~/Vaultisse-Videos/2026-11-27_admin-panel-setup_v1.3.9/
├── video.mp4                  the finished video (intro + main + outro, subtitles NOT burned in)
├── cover.png                  the YouTube cover, 1280x720, under 2 MB
├── README.md                  the YouTube texts: title, description, tags, chapters (see section 4)
├── subtitles/
│   ├── en.srt   es.srt   ca.srt   de.srt
├── transcripts/
│   ├── en.md    es.md    ca.md    de.md
├── audio/                     narration, one file per language that was produced (see section 6)
│   ├── narration.en.wav       (and es/ca/de when produced)
├── upload.json                written after the upload: video id, url, what was set, when
└── work/                      scratch (raw recording, frames, slides); safe to delete, never uploaded
```

- Only **text sources** go in the repository: the episode script (section 5) lives in `tools/video/episodes/<slug>.json` so the
  video can be rebuilt for the next version. No media, no credentials, no folder from the output directory.
- Credentials: the Google OAuth client file and the token live in `~/.config/vaultisse-video/` (`client_secret.json`, `token.json`).
  **Never print them, never copy them into the repository or into a video folder, never commit them.** The repository's
  `.gitignore` already refuses `*.mp4`, `client_secret*.json` and `youtube-token*.json`.

## 3. The version

Every title ends with the version the video belongs to.

- Use the version the owner names. If none is named, use `version` in the repository's root `package.json` (the release anchor).
- A feature not released yet belongs to the next version (the database upgrade file `assets/db/upgrade/<version>.sql` names it).
- The same text appears in the folder name (`..._v1.3.9`), the title and the description.

## 4. The YouTube texts (`README.md` inside the video folder)

Write this file so the owner can read it, and so the upload step can read it. Use exactly these headings.

````markdown
# <title>

## Title
𝗔𝗱𝗺𝗶𝗻 𝗽𝗮𝗻𝗲𝗹: Set it up and sign in for the first time — v1.3.9

## Description
<see the template below>

## Tags
vaultisse, self-hosted library, book collection manager, admin panel, docker compose, ...

## Chapters
0:00 Introduction
0:32 Start the admin panel
...

## Localized titles and descriptions
### es
Title: ...
Description: ...
### ca
...
### de
...

## Settings
Category: Science & Technology (28)
Language: en
Audience: not made for kids
Visibility: private        <- from VIDEO_PRIVACY
Playlist: Setup            <- from the playlist map in config.env, if any
````

**Title rules**

1. It **starts with the topic in bold followed by a colon**, then what is explained: `𝗦𝗲𝘁𝘂𝗽: Install Vaultisse with Docker — v1.3.9`.
   YouTube titles cannot be formatted, so the bold is made with Unicode bold letters (𝗦𝗲𝘁𝘂𝗽 = Mathematical Sans-Serif Bold, U+1D5D4 to U+1D5ED
   for A-Z and U+1D5EE to U+1D607 for a-z; digits U+1D7EC to U+1D7F5). Convert the topic word(s) only, not the whole title.
2. It **ends with the version**: ` — v<version>`.
3. After the bold topic comes **the question or task in plain words, the way people search for it** ("How to ...", "Set up ...", "Fix ...", "What is ..."),
   with the product name `Vaultisse` in it, and the main keyword as early as possible. Precise beats clever: no puns, no vague titles.
4. At most 100 characters **counted as YouTube counts them** (the bold letters are two UTF-16 units each; keep a margin). Shorten the
   sentence, never the version.
5. Topics to use as the bold start: `Setup`, `Admin panel`, `Security`, `Compliance`, `Accounts`, `Library`, `Loans`, `What's new`, `Tutorial`.
6. Write the localized titles the same way, in their language, **using the words people search for in that language** (not a literal translation), with the same bold topic and the same version.

**Description template** (English; keep the same shape in the other languages)

```
<One sentence saying what you will learn.>

In this video:
0:00 Introduction
0:32 ...

Vaultisse is an open-source, self-hosted way to track, organise and share a book collection.
Website: https://vaultisse.com
Source and docs: https://github.com/AlbertAmat/vaultisse
Docs for this video: <link to the matching page in docs/, for example docs/ADMIN.md#...>
Version shown: v<version>

#vaultisse #selfhosted #opensource
```

- The first two lines are what people see before "more": say exactly what the video shows, with the search phrase in the first sentence, no links before them.
- Chapters: the first must be `0:00`, at least three, each at least 10 seconds, in order (a 3-minute video usually has 3 to 5). They come from the real timestamps of the finished video.
- Tags: 8 to 15, the whole list under 500 characters, most specific first: the exact search phrase and its variants ("vaultisse smtp setup", "vaultisse email"), then the topic, then `vaultisse`. Always include `vaultisse`.
- If the video belongs to a series, the description lists the other parts with their links (add them as they are uploaded).
- Never put secrets, real names, real addresses or private URLs anywhere in the texts.

## 5. The episode script (`tools/video/episodes/<slug>.json`)

One file per video, the single source of truth. It is what lets the video be rebuilt for the next version.

```json
{
  "slug": "admin-panel-setup",
  "topic": "Admin panel",
  "title": "Set it up and sign in for the first time",
  "playlist": "Setup",
  "docs": "docs/ADMIN.md#turning-it-on",
  "intro": {
    "bullets": ["Start the admin panel", "Sign in and set up two-factor", "Use the setup guide"],
    "narration": { "en": "In this video ...", "es": "...", "ca": "...", "de": "..." }
  },
  "steps": [
    {
      "id": "open",
      "title": "Open the console",
      "narration": { "en": "...", "es": "...", "ca": "...", "de": "..." },
      "actions": [ { "goto": "/login" }, { "pause": 1.5 }, { "type": "Email", "text": "admin@vaultisse.local" } ]
    }
  ],
  "outro": { "next": "Manage accounts and vaults" }
}
```

- **Narration** is written once in English and translated, not machine-literal: natural, short sentences, about 150 words per minute, **about 300 words for the whole video** (the 3-minute limit leaves no room for more). Cut every sentence that is not needed to answer the one question.
  Read every line aloud in your head; if it is awkward to say, rewrite it.
- **Actions** are what the browser does: `goto`, `click`, `type`, `select`, `scroll`, `highlight` (a soft ring around an element), `zoom`
  (a smooth zoom on a region), `pause` (seconds). Every action waits for the page to settle. Human pacing: a typed character every 40 to 70 ms,
  a pause of at least one second after each screen change so the viewer can read, never a jump cut inside a step.
- A step's length is the longer of its actions and its narration, so the picture never runs ahead of the words.

## 6. Voice, subtitles and what YouTube can and cannot do

The owner wants YouTube to speak the video in several languages from the subtitles. **YouTube does not do that.** Be clear about it, and
build the video so it still works:

- Uploaded **subtitles** (captions) are text shown on screen. YouTube does **not** turn them into speech.
- YouTube's **auto-dubbing** translates **spoken audio** that is already in the video. A silent video has nothing to dub, and it is only offered to some channels.

So the video needs real audio:

1. **Produce an English narration** (`audio/narration.en.wav`) and mix it into `video.mp4`. Use, in this order: a recording the owner dropped
   in the folder; the text-to-speech tool named in `config.env` (`VIDEO_TTS`); otherwise stop and ask. Do not publish a silent video without saying so.
2. Produce `audio/narration.es.wav`, `ca`, `de` the same way **when a tool for that language is configured**. They are kept for the owner to
   add as extra **audio tracks** in YouTube Studio (YouTube's *multiple audio tracks* feature), or to use for dubbed versions. The API cannot upload them.
3. Always produce the **four subtitle files**, whatever the audio. They are uploaded through the API and YouTube shows the one matching the viewer's language.
4. State in the reply what was produced and what was not.

**Subtitle files**

- SRT, UTF-8, one cue per sentence, at most two lines of 42 characters, 1 to 7 seconds each, no overlap, timed from the **real** step timings of the
  finished video (not estimated). The intro and outro are included.
- The English file is the source; the others are translations that keep the same cues and timestamps. Keep product words as they are in the app
  (the names of pages and buttons as the app shows them: for the end-user app, switch the app to that language and read its labels; the admin panel is in English only, so keep its English names in every language).
- The transcript (`transcripts/<lang>.md`) is the same text as plain paragraphs under the step titles, without timestamps.
- Languages: `en` English, `es` Spanish (Spain), `ca` Catalan, `de` German. Language codes for the API: `en`, `es`, `ca`, `de`.

## 7. The look

Generate every visual from HTML rendered with Playwright (already installed with the project) so it matches the brand, then compose with `ffmpeg`.

**Brand**: logo from `admin/src/components/BrandMark.vue`, fonts Fraunces (titles) and Inter (text), colours from
`admin/src/plugins/vuetify.ts`: beige `#f7f2ea`, copper `#c97b3d`, dark brown `#2f2a22`, dark-blue theme `#0d1420` / `#1c7ff1`.

**Intro (20 to 30 seconds, 3 to 4 slides, 1920x1080; the whole video stays within 3 minutes)**

1. Title slide (4 to 5 s): a nice image as the background (a soft gradient with a large blurred screenshot of the app, or a tidy bookshelf-style
   illustration drawn in HTML/CSS), the logo, the **topic in large type**, the title, `v<version>`.
2. "In this video" (about 8 s): the 2 to 4 bullets from the script, appearing one by one.
3. "Before you start" (optional, about 6 s): what is needed (Docker, a domain, the `.env` file ...).
4. A last slide that dissolves into the app (about 3 s).
Narration of the introduction (`intro.narration`) is spoken over the slides, about 50 to 70 words, and tells the viewer in one sentence the exact thing they will be able to do at the end. Crossfades of 0.4 s between slides. Subtle motion (a slow zoom) so it does not feel frozen.

**Main video: a desktop application look**

- Canvas 1920x1080. **Background**: a soft gradient or a calm blurred wallpaper in the brand colours (warm beige to copper for the light theme, deep blue for the dark one). Never plain black or white.
- **The web page is centered** in a window about **1600x900**, with **rounded corners (radius 18 px)**, a soft large shadow, and a thin 1 px light border.
  Above the page, a **title bar** (36 px) like a native app: the three round window buttons on the left, the page title centered, nothing clickable.
  Do not show a real browser: no tabs, no address bar of a real browser, no extensions, no bookmarks.
- Record the page at **1600x900 (or 1536x864 for a sharper scale-down)**, device scale factor 1 or 2, light or dark theme as the script says.
  Prefer the Chrome DevTools screencast (frame by frame, `Page.startScreencast` at JPEG quality 100) over Playwright's built-in `recordVideo`: it is sharper.
  Fall back to `recordVideo` only if the screencast fails.
- Compose with `ffmpeg`: the recording is scaled, masked with a rounded-rectangle alpha PNG (render it once with Playwright, transparent background),
  overlaid on the background image together with a pre-rendered shadow PNG and the title bar PNG. Keep the cursor visible: draw a pointer and a soft click ripple in the page itself.
- Smooth zoom on a region when the narration points at it (scale 1.0 to 1.35 over 0.6 s, then back), never more than 1.5x, never while typing.
- Encode H.264 (`libx264`, CRF 18, `yuv420p`), AAC audio 192 kb/s, `+faststart`. Loudness about -16 LUFS. Fade the music (if any) under the voice by 18 dB.
- Optional background music: only royalty-free music the owner provided in `VIDEO_MUSIC_DIR`. Never use a track whose licence is unknown.

**Cover (`cover.png`, 1280x720, under 2 MB)**

The topic in large bold type, the title in a smaller line, `v<version>`, the logo, and a crisp screenshot of the relevant page in the rounded window on the right.
High contrast, at most 6 words in large type, readable at thumbnail size (judge it at 320x180 before accepting it). No tiny text, no faces, no clickbait.

## 8. The data shown must be demo data only

The app is recorded against a **fresh throwaway installation** with made-up data, never the owner's real installation.

- Start a clean database and server on non-standard ports (copy the approach used for the documentation screenshots in `docs/images/admin/`:
  new database, `ADMIN_ENABLED=true`, a local SMTP sink, seeded fake people such as *Alice Martin* with `@example.com` addresses).
- Passwords, codes and keys visible on screen are made-up ones that exist only in that throwaway installation. Never show a real `.env`, a real token, a real IP address of the owner, real customers, or the YouTube credentials.
- Before the final render, **watch the frames of the finished video** (sample one every two seconds) and check for anything sensitive. If in doubt, redo that step.

## 9. The procedure

Do the steps in order and keep going without asking, unless something is unclear or missing (a credential, a TTS tool, the version).

1. **Understand the request.** Topic, audience (setup, management, end user, promo, release), version. If it is a release video, read the release notes (the GitHub release, or `git log <previous tag>..HEAD`) and the matching sections of `docs/`, and
   make one step per feature that matters to a user; never claim something the app does not do. Verify every claim against the running app or the docs.
2. **Check the setup.** `config.env` exists, `ffmpeg` and Playwright's Chromium work, the output directory is writable, the YouTube client file exists. Report what is missing and stop if the upload cannot work (the owner can still get the files).
3. **Write or update `tools/video/episodes/<slug>.json`** (section 5). **Check the length first**: if the outline will not fit in 3 minutes, split the topic into a series and make the first part (say so in the reply and list the other parts). Show the owner a **short outline** (title, the steps, the estimated length) in the reply, then continue without waiting.
4. **Prepare the demo installation** (section 8).
5. **Record** each step. Re-run a step that stumbled (a slow load, a misclick). Keep the raw recording in `work/`.
6. **Make the intro, outro and cover** (section 7).
7. **Narration**: produce the English audio (section 6) and measure each step's real duration.
8. **Compose** `video.mp4`: intro, main, outro, audio.
9. **Write the subtitles and transcripts** for `en`, `es`, `ca`, `de` from the real timings, then **write `README.md`** (section 4) with the real chapter timestamps.
10. **Check** (section 10). Fix anything that fails and re-check.
11. **Upload** (section 11).
12. **Report**: folder path, YouTube link, title, duration, what was produced and what was not (extra audio tracks), anything the owner must do by hand.

## 10. Checks before the upload

- **Duration: 180 seconds or less. Over that, the video fails the check: cut or split it, never upload it.**
- `ffprobe`: 1920x1080, 30 fps, H.264 + AAC, the duration within 10% of the sum of the step durations; audio present and not silent; no clipping.
- The title and the first sentence of the description contain the exact phrase the video answers.
- The first frame is the intro and the last frame is the outro; no black frames longer than 0.3 s; no frozen section longer than 3 s outside the intro.
- Subtitles: valid SRT, no cue shorter than 1 s or longer than 7 s, no overlap, the last cue ends before the video does; four files; the same number of cues in each.
- Title: starts with the bold topic and a colon, ends with ` — v<version>`, within YouTube's length. Description under 5,000 characters. Tags under 500.
- `cover.png`: 1280x720, under 2 MB.
- Chapters match real moments of the video.
- Nothing sensitive in the frames, texts or filenames (section 8).
- Nothing from the output directory or credentials is staged in git (`git status` shows no media).

## 11. Uploading to YouTube

Use the **YouTube Data API v3** with OAuth 2.0 (a "Desktop app" OAuth client the owner creates in Google Cloud and puts at `YOUTUBE_CLIENT_SECRET`).
The first run opens a browser for the owner to approve and stores the token at `YOUTUBE_TOKEN`; later runs reuse it. Scopes:
`https://www.googleapis.com/auth/youtube.upload` and `https://www.googleapis.com/auth/youtube.force-ssl` (captions, localizations, playlists).

For each video, in this order:

1. `videos.insert` (resumable upload) with `snippet.title`, `snippet.description`, `snippet.tags`, `snippet.categoryId` (28), `snippet.defaultLanguage` and
   `snippet.defaultAudioLanguage` = `en`, `status.privacyStatus` = `VIDEO_PRIVACY`, `status.selfDeclaredMadeForKids` = false,
   `status.embeddable` = true. For a scheduled release set `status.publishAt` (private + `publishAt`).
2. `thumbnails.set` with `cover.png`.
3. `captions.insert` for each of `en`, `es`, `ca`, `de` (`snippet.language`, `snippet.name` = the language name, `isDraft` false) with the `.srt`.
4. `videos.update` (`part=localizations`) with the localized titles and descriptions for `es`, `ca`, `de` (and `en`), from section 4.
5. `playlistItems.insert` into the playlist named in the script, if `YOUTUBE_PLAYLISTS` maps it to an id.
6. Write `upload.json`: `{videoId, url, uploadedAt, privacy, title, captions: [...], playlist}`.

Rules:

- **Default visibility is `private`** (`VIDEO_PRIVACY=private`) until the owner has watched the result and sets `VIDEO_PRIVACY=public` (or `unlisted`) in `config.env`. Never make a video public on your own.
- Quota: the default allowance is **10,000 units a day**; an upload costs about 1,600, each caption about 400, so one video with four captions is about 3,300: at most about three videos a day. If the quota is exhausted, keep the folder complete, write what is left to do in `upload.json`, and tell the owner.
- **Important:** videos uploaded through the API by a Google Cloud project that has **not passed YouTube's API compliance audit** are **locked as private**, whatever was requested. If the video stays private, say so
  and point the owner to YouTube's audit form. Until then they can make it public in YouTube Studio with one click.
- If an upload fails halfway, do not upload a second copy: read `upload.json`, resume (set the missing thumbnail, captions, localizations) on the same video id.
- Never delete or edit a video that is already on the channel unless the owner asks for exactly that.
- Never print the token or the client secret, not even partly, not even in an error.

## 12. Kinds of videos and what to put in them

Every row below is **several short videos of up to 3 minutes**, one precise thing each, never one long video.

| Kind | Examples | Notes |
|---|---|---|
| **Setup** | One video each: install with Docker; fill the `.env` file; start the admin panel; first sign-in and two-factor; set up email; set up single sign-on; upgrade to a new version | Show commands in a terminal-looking window; say the admin panel should stay off the internet (see [`docs/ADMIN.md`](../../docs/ADMIN.md)). |
| **Management** | One video each: approve a new account; merge two accounts; clear a vault; block an address; read the admin sign-in history; answer a GDPR request; set data retention; add a webhook | One precise task per video, named as people ask it. |
| **End user** | Add a book by ISBN; organise with categories and locations; lend and return; print labels and library cards; import | Use the app itself, not the admin panel. |
| **Promo** | A 60 to 90 second trailer | No narration walk-through: short on-screen lines, music from `VIDEO_MUSIC_DIR`, the best five moments of the app, a clear call to action. |
| **Release** | "What's new in v1.3.9" | At most 4 highlights, one slide and about 20 seconds each; the upgrade note in the last seconds ("upgrading is `docker compose pull && docker compose up -d`"); link the release notes. A release with more highlights gets one short video per big feature, plus this overview. |

## 13. What not to do

- Do not store videos, audio, images generated for a video, subtitles or credentials in the repository.
- Do not show real data, real credentials or the owner's own installation on screen.
- Do not invent features, numbers or commands: verify against the app and the docs.
- Do not machine-translate word for word; keep each language natural, and keep the product's own terms.
- Do not publish publicly unless `VIDEO_PRIVACY=public` is set by the owner.
- Do not leave the video unfinished silently: if a step cannot be done, say which and why.

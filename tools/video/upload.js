#!/usr/bin/env node
/**
 * Uploads finished video folders to YouTube (README.md in this folder, section 11).
 *
 *   node tools/video/upload.js --dry-run              show what would be sent, send nothing
 *   node tools/video/upload.js lend-return            upload the named videos
 *   node tools/video/upload.js --limit 5              upload the videos ticked as finished, 5 at most
 *
 *   node tools/video/upload.js --limit 5 --unattended    for a timer: fail instead of waiting for a browser sign-in
 *
 *   node tools/video/upload.js --videos-only            upload files and texts (translations included) and leave
 *                                                       subtitles, cover and playlist for a later run; this
 *                                                       uses only the separate daily allowance for uploads
 *
 * Settings come from ~/.config/vaultisse-video/config.env. Progress is kept in each folder's upload.json,
 * so running again continues where it stopped and never uploads a video twice.
 */
'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const CONFIG_FILE = path.join(os.homedir(), '.config/vaultisse-video/config.env');
const EPISODES_DIR = path.join(__dirname, 'episodes');
const API = 'https://www.googleapis.com/youtube/v3';
const UPLOAD_API = 'https://www.googleapis.com/upload/youtube/v3';
const SCOPES = ['https://www.googleapis.com/auth/youtube.upload', 'https://www.googleapis.com/auth/youtube.force-ssl'];
const LANGUAGES = { en: 'English', es: 'Español', ca: 'Català', de: 'Deutsch' };
const TRANSLATED = ['es', 'ca', 'de'];

/** Fixed phrases of the translated descriptions. */
const PHRASES = {
  es: { inVideo: 'En este vídeo:', intro: 'Introducción', about: 'Vaultisse es una forma libre y autoalojada de registrar, organizar y compartir una colección de libros.', website: 'Web', source: 'Código y documentación', docs: 'Documentación de este vídeo', version: 'Versión mostrada', voices: 'Voces de la narración' },
  ca: { inVideo: 'En aquest vídeo:', intro: 'Introducció', about: 'Vaultisse és una manera lliure i autoallotjada de registrar, organitzar i compartir una col·lecció de llibres.', website: 'Web', source: 'Codi i documentació', docs: "Documentació d'aquest vídeo", version: 'Versió mostrada', voices: 'Veus de la narració' },
  de: { inVideo: 'In diesem Video:', intro: 'Einführung', about: 'Vaultisse ist eine quelloffene, selbst gehostete Lösung, um eine Büchersammlung zu erfassen, zu ordnen und zu teilen.', website: 'Website', source: 'Quellcode und Doku', docs: 'Doku zu diesem Video', version: 'Gezeigte Version', voices: 'Sprecherstimmen' },
};

/** An error answered by Google, with the HTTP status and the machine-readable reason. */
class ApiError extends Error {
  /** Keeps the status and reason so callers can decide what to do. Never holds tokens or secrets. */
  constructor(status, reason, message) {
    super(`${status} ${reason}: ${message}`);
    this.status = status;
    this.reason = reason;
  }

  /** Builds the error from a failed fetch response. */
  static async from(response) {
    const body = await response.json().catch(() => ({}));
    const error = body.error || {};
    const reason = error.errors?.[0]?.reason || (typeof error === 'string' ? error : 'error');
    return new ApiError(response.status, reason, error.message || body.error_description || response.statusText);
  }

  /** True when no more calls can succeed today. */
  get isOutOfQuota() {
    return ['quotaExceeded', 'dailyLimitExceeded', 'uploadLimitExceeded', 'rateLimitExceeded'].includes(this.reason);
  }
}

/** The settings of config.env. */
class Config {
  /** Reads KEY=VALUE lines and expands a leading ~ to the home directory. */
  constructor(file) {
    const values = {};
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
      if (match) values[match[1]] = match[2].replace(/^~(?=\/)/, os.homedir());
    }
    const folder = path.dirname(file);
    this.outputDir = values.VIDEO_OUTPUT_DIR || path.join(os.homedir(), 'Vaultisse-Videos');
    this.clientSecretFile = values.YOUTUBE_CLIENT_SECRET || path.join(folder, 'client_secret.json');
    this.tokenFile = values.YOUTUBE_TOKEN || path.join(folder, 'token.json');
    this.privacy = values.VIDEO_PRIVACY || 'private';
    if (!['private', 'unlisted', 'public'].includes(this.privacy)) throw new Error(`VIDEO_PRIVACY must be private, unlisted or public`);
    this.playlists = Object.fromEntries((values.YOUTUBE_PLAYLISTS || '').split(',').filter((p) => p.includes('=')).map((p) => p.split('=').map((s) => s.trim())));
  }
}

/** One video folder: its YouTube texts, files and upload progress. */
class VideoFolder {
  /** Reads the texts of the folder's README.md and the progress of upload.json. */
  constructor(dir) {
    this.dir = dir;
    this.name = path.basename(dir);
    this.slug = this.name.split('_')[1];
    const sections = VideoFolder.sections(fs.readFileSync(path.join(dir, 'README.md'), 'utf8'));
    this.title = sections.Title;
    this.description = sections.Description;
    this.tags = (sections.Tags || '').split(',').map((t) => t.trim()).filter(Boolean);
    this.localized = VideoFolder.localizedTexts(sections['Localized titles and descriptions'] || '');
    const settings = sections.Settings || '';
    this.category = settings.match(/^Category:.*\((\d+)\)/m)?.[1] || '28';
    this.playlist = settings.match(/^Playlist:\s*(.+?)\s*$/m)?.[1] || null;
    this.video = path.join(dir, 'video.mp4');
    this.cover = path.join(dir, 'cover.png');
    this.stateFile = path.join(dir, 'upload.json');
    this.state = fs.existsSync(this.stateFile) ? JSON.parse(fs.readFileSync(this.stateFile, 'utf8')) : {};
  }

  /** Splits a markdown text into { heading: body } by its "## " headings. */
  static sections(markdown) {
    const result = {};
    for (const part of markdown.split(/^## /m).slice(1)) {
      const end = part.indexOf('\n');
      result[part.slice(0, end).trim()] = part.slice(end + 1).trim();
    }
    return result;
  }

  /** Reads the "### es" blocks into { es: { title, description } }. */
  static localizedTexts(block) {
    const result = {};
    for (const part of block.split(/^### /m).slice(1)) {
      const lang = part.slice(0, part.indexOf('\n')).trim();
      const title = part.match(/^Title:\s*(.+)$/m)?.[1];
      const description = part.match(/^Description:\s*([\s\S]+)$/m)?.[1].trim();
      if (title && description) result[lang] = { title, description };
    }
    return result;
  }

  /** The subtitle file of a language. */
  subtitle(lang) {
    return path.join(this.dir, 'subtitles', `${lang}.srt`);
  }

  /** Lists what is missing or over YouTube's limits. Empty when the folder can be uploaded. */
  problems() {
    const found = [];
    for (const file of [this.video, this.cover, ...Object.keys(LANGUAGES).map((l) => this.subtitle(l))]) {
      if (!fs.existsSync(file)) found.push(`missing ${path.relative(this.dir, file)}`);
    }
    if (!this.title) found.push('no title');
    else if (this.title.length > 100) found.push('title over 100 characters');
    if (!this.description) found.push('no description');
    else if (this.description.length > 5000) found.push('description over 5000 characters');
    if (this.tags.join(',').length > 500) found.push('tags over 500 characters');
    return found;
  }

  /**
   * The full description in another language: translated sentence, chapters and links. Chapter times come from the
   * English description and their names from the episode script; without a match only the sentence is returned.
   */
  localizedDescription(lang) {
    const sentence = this.localized[lang].description;
    const phrases = PHRASES[lang];
    const episodeFile = path.join(EPISODES_DIR, `${this.slug}.json`);
    if (!phrases || !fs.existsSync(episodeFile)) return sentence;
    const steps = JSON.parse(fs.readFileSync(episodeFile, 'utf8')).steps || [];
    const chapters = [...this.description.matchAll(/^(\d+:\d{2}) (.+)$/gm)].map(([, time, name]) => {
      const step = steps.find((s) => s.title?.en === name);
      const translated = name === 'Introduction' ? phrases.intro : step?.title?.[lang];
      return translated ? `${time} ${translated}` : null;
    });
    if (!chapters.length || chapters.includes(null)) return sentence;
    const line = (pattern) => this.description.match(pattern)?.[1];
    const links = [
      `${phrases.website}: https://vaultisse.com`,
      `${phrases.source}: https://github.com/AlbertAmat/vaultisse`,
      line(/^Docs for this video: (.+)$/m) && `${phrases.docs}: ${line(/^Docs for this video: (.+)$/m)}`,
      line(/^Version shown: (.+)$/m) && `${phrases.version}: ${line(/^Version shown: (.+)$/m)}`,
      line(/^Narration voices \(Piper\): (.+)$/m) && `${phrases.voices} (Piper): ${line(/^Narration voices \(Piper\): (.+)$/m)}`,
    ].filter(Boolean);
    return [sentence, '', phrases.inVideo, ...chapters, '', phrases.about, ...links, '', '#vaultisse #selfhosted #opensource'].join('\n');
  }

  /** The title and description of every language, as YouTube's "localizations" expects them. */
  localizations() {
    const result = { en: { title: this.title, description: this.description } };
    for (const lang of TRANSLATED.filter((l) => this.localized[l])) {
      result[lang] = { title: this.localized[lang].title, description: this.localizedDescription(lang) };
    }
    return result;
  }

  /** Saves progress to upload.json at once, so an interrupted run can continue. */
  save(changes) {
    Object.assign(this.state, changes);
    fs.writeFileSync(this.stateFile, `${JSON.stringify(this.state, null, 2)}\n`);
  }
}

/** Google sign-in for a desktop app: browser approval once, then the stored refresh token. */
class GoogleAuth {
  /** Reads the OAuth client file. Nothing read here is ever printed. */
  constructor(config, { unattended = false } = {}) {
    this.unattended = unattended;
    this.client = JSON.parse(fs.readFileSync(config.clientSecretFile, 'utf8')).installed;
    if (!this.client) throw new Error('The client file is not a "Desktop app" OAuth client');
    this.tokenFile = config.tokenFile;
    this.token = null;
    this.expiresAt = 0;
  }

  /** Returns a valid access token, asking the owner to approve in the browser if there is none. */
  async accessToken() {
    if (this.token && Date.now() < this.expiresAt - 60_000) return this.token;
    const stored = fs.existsSync(this.tokenFile) ? JSON.parse(fs.readFileSync(this.tokenFile, 'utf8')) : null;
    if (stored?.refresh_token) {
      try {
        return this.keep(await this.exchange({ grant_type: 'refresh_token', refresh_token: stored.refresh_token }));
      } catch (error) {
        if (error.reason !== 'invalid_grant') throw error;
        console.log('The stored sign-in expired, asking again.');
      }
    }
    if (this.unattended) throw new Error('Google sign-in needed: run tools/video/upload.js by hand once to approve it');
    const answer = await this.authorize();
    if (!answer.refresh_token) throw new Error('Google returned no refresh token');
    fs.writeFileSync(this.tokenFile, JSON.stringify({ refresh_token: answer.refresh_token }), { mode: 0o600 });
    return this.keep(answer);
  }

  /** Remembers an access token for this run. */
  keep(answer) {
    this.token = answer.access_token;
    this.expiresAt = Date.now() + answer.expires_in * 1000;
    return this.token;
  }

  /** Calls Google's token endpoint. */
  async exchange(parameters) {
    const response = await fetch(this.client.token_uri, {
      method: 'POST',
      body: new URLSearchParams({ client_id: this.client.client_id, client_secret: this.client.client_secret, ...parameters }),
    });
    if (!response.ok) throw await ApiError.from(response);
    return response.json();
  }

  /** Runs the loopback sign-in: opens the browser and waits for Google to redirect back with a code. */
  async authorize() {
    const state = crypto.randomBytes(16).toString('hex');
    const verifier = crypto.randomBytes(48).toString('base64url');
    let redirectUri;
    const server = http.createServer();
    const code = new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('No approval within 9 minutes')), 540_000);
      server.on('request', (request, response) => {
        const url = new URL(request.url, redirectUri);
        if (url.searchParams.get('state') !== state) return response.writeHead(404).end();
        clearTimeout(timer);
        response.writeHead(200, { 'Content-Type': 'text/plain' }).end('Done. You can close this tab.');
        if (url.searchParams.get('code')) resolve(url.searchParams.get('code'));
        else reject(new Error(`Sign-in refused: ${url.searchParams.get('error')}`));
      });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    redirectUri = `http://127.0.0.1:${server.address().port}`;
    const url = `${this.client.auth_uri}?${new URLSearchParams({
      client_id: this.client.client_id,
      redirect_uri: redirectUri,
      response_type: 'code',
      scope: SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state,
      code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    })}`;
    console.log(`\nApprove the access in your browser (choose the channel to upload to):\n${url}\n`);
    spawn('xdg-open', [url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref();
    try {
      return await this.exchange({ grant_type: 'authorization_code', code: await code, redirect_uri: redirectUri, code_verifier: verifier });
    } finally {
      server.closeAllConnections();
      server.close();
    }
  }
}

/** The few YouTube Data API calls the upload needs. */
class YouTube {
  /** Uses the given sign-in for every call. */
  constructor(auth) {
    this.auth = auth;
  }

  /** Sends an authorised request and returns the response, throwing ApiError on failure. */
  async request(url, options = {}, accepted = []) {
    const headers = { Authorization: `Bearer ${await this.auth.accessToken()}`, ...options.headers };
    const response = await fetch(url, { ...options, headers, redirect: 'manual' });
    if (!response.ok && !accepted.includes(response.status)) throw await ApiError.from(response);
    return response;
  }

  /** A JSON call to the data API. */
  async call(method, resource, query, body) {
    const response = await this.request(`${API}/${resource}?${new URLSearchParams(query)}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body && JSON.stringify(body),
    });
    return response.json();
  }

  /** The channel the uploads go to. */
  async channel() {
    const { items } = await this.call('GET', 'channels', { part: 'snippet', mine: 'true' });
    if (!items?.length) throw new Error('This Google account has no YouTube channel');
    return items[0].snippet.title;
  }

  /** Opens a resumable upload session and returns its address. */
  async startUpload(metadata, size) {
    const query = new URLSearchParams({ uploadType: 'resumable', part: Object.keys(metadata).join(',') });
    const response = await this.request(`${UPLOAD_API}/videos?${query}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Upload-Content-Type': 'video/mp4', 'X-Upload-Content-Length': String(size) },
      body: JSON.stringify(metadata),
    });
    return response.headers.get('location');
  }

  /** Sends the file to a session, from where an earlier attempt stopped, and returns the created video. */
  async finishUpload(session, file) {
    const data = fs.readFileSync(file);
    const status = await this.request(session, { method: 'PUT', headers: { 'Content-Range': `bytes */${data.length}` } }, [308]);
    if (status.status !== 308) return status.json();
    const received = status.headers.get('range');
    const from = received ? Number(received.split('-')[1]) + 1 : 0;
    const response = await this.request(session, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/mp4', 'Content-Range': `bytes ${from}-${data.length - 1}/${data.length}` },
      body: data.subarray(from),
    });
    return response.json();
  }

  /** Sets the cover image of a video. */
  async setThumbnail(videoId, file) {
    await this.request(`${UPLOAD_API}/thumbnails/set?videoId=${videoId}`, {
      method: 'POST',
      headers: { 'Content-Type': 'image/png' },
      body: fs.readFileSync(file),
    });
  }

  /** Adds one subtitle track. */
  async addCaption(videoId, language, name, file) {
    const boundary = `vaultisse-${crypto.randomBytes(12).toString('hex')}`;
    const snippet = JSON.stringify({ snippet: { videoId, language, name, isDraft: false } });
    const body = Buffer.concat([
      Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${snippet}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`),
      fs.readFileSync(file),
      Buffer.from(`\r\n--${boundary}--`),
    ]);
    await this.request(`${UPLOAD_API}/captions?uploadType=multipart&part=snippet`, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
      body,
    });
  }

  /** Returns the id of the channel's playlist with this title, creating a private one if there is none. */
  async playlistId(title) {
    let pageToken = '';
    do {
      const page = await this.call('GET', 'playlists', { part: 'snippet', mine: 'true', maxResults: '50', pageToken });
      const found = page.items.find((p) => p.snippet.title === title);
      if (found) return found.id;
      pageToken = page.nextPageToken || '';
    } while (pageToken);
    const created = await this.call('POST', 'playlists', { part: 'snippet,status' }, { snippet: { title }, status: { privacyStatus: 'private' } });
    return created.id;
  }
}

/** Uploads one folder step by step, skipping what upload.json says is done. */
class Uploader {
  /** Takes the settings and the API client. */
  constructor(config, youtube, { videosOnly = false } = {}) {
    this.videosOnly = videosOnly;
    this.config = config;
    this.youtube = youtube;
    this.playlistIds = { ...config.playlists };
  }

  /** What videos.insert receives. Visibility is always stated: leaving it out would publish the video. */
  metadata(folder) {
    return {
      snippet: {
        title: folder.title,
        description: folder.description,
        tags: folder.tags,
        categoryId: folder.category,
        defaultLanguage: 'en',
        defaultAudioLanguage: 'en',
      },
      localizations: folder.localizations(),
      status: { privacyStatus: this.config.privacy, selfDeclaredMadeForKids: false, embeddable: true },
      paidProductPlacementDetails: { hasPaidProductPlacement: false },
    };
  }

  /** Runs every missing step. A refused cover is reported and the rest continues. */
  async upload(folder) {
    await this.uploadVideo(folder);
    if (this.videosOnly) return;
    const { videoId } = folder.state;
    if (!folder.state.thumbnail) {
      try {
        await this.youtube.setThumbnail(videoId, folder.cover);
        folder.save({ thumbnail: true });
        console.log('  cover set');
      } catch (error) {
        if (!(error instanceof ApiError) || error.isOutOfQuota) throw error;
        console.log(`  cover NOT set (${error.message})`);
      }
    }
    for (const [lang, name] of Object.entries(LANGUAGES)) {
      const done = folder.state.captions || [];
      if (done.includes(lang)) continue;
      try {
        await this.youtube.addCaption(videoId, lang, name, folder.subtitle(lang));
      } catch (error) {
        if (error.reason !== 'captionExists') throw error;
      }
      folder.save({ captions: [...done, lang] });
      console.log(`  subtitles ${lang}`);
    }
    if (!folder.state.localizations) {
      await this.addLocalizations(videoId, folder.localizations());
      folder.save({ localizations: true });
      console.log('  translated titles and descriptions');
    }
    if (folder.playlist && !folder.state.playlist) {
      this.playlistIds[folder.playlist] ||= await this.youtube.playlistId(folder.playlist);
      await this.youtube.call('POST', 'playlistItems', { part: 'snippet' }, {
        snippet: { playlistId: this.playlistIds[folder.playlist], resourceId: { kind: 'youtube#video', videoId } },
      });
      folder.save({ playlist: folder.playlist });
      console.log(`  added to playlist "${folder.playlist}"`);
    }
  }

  /**
   * Sets the translated titles and descriptions. A video uploaded in YouTube Studio may have no default language,
   * which YouTube requires first: it is then set to English, keeping the rest of the video's texts as they are.
   */
  async addLocalizations(videoId, localizations) {
    const send = () => this.youtube.call('PUT', 'videos', { part: 'localizations' }, { id: videoId, localizations });
    try {
      await send();
    } catch (error) {
      if (error.reason !== 'defaultLanguageNotSet') throw error;
      const { items } = await this.youtube.call('GET', 'videos', { part: 'snippet', id: videoId });
      const { title, description, tags, categoryId, defaultAudioLanguage } = items[0].snippet;
      await this.youtube.call('PUT', 'videos', { part: 'snippet' }, {
        id: videoId,
        snippet: { title, description, tags, categoryId, defaultAudioLanguage, defaultLanguage: 'en' },
      });
      await send();
    }
  }

  /** Uploads the video file, or continues the session of an interrupted attempt. */
  async uploadVideo(folder) {
    if (folder.state.videoId) return;
    if (!folder.state.session) {
      folder.save({ session: await this.youtube.startUpload(this.metadata(folder), fs.statSync(folder.video).size) });
    }
    let video;
    try {
      video = await this.youtube.finishUpload(folder.state.session, folder.video);
    } catch (error) {
      // An expired session cannot be resumed: forget it so the next run starts a new one.
      if (error.status === 404 || error.status === 410) folder.save({ session: undefined });
      throw error;
    }
    folder.save({
      session: undefined,
      videoId: video.id,
      url: `https://youtu.be/${video.id}`,
      uploadedAt: new Date().toISOString(),
      privacy: video.status.privacyStatus,
      title: folder.title,
      localizations: Boolean(video.localizations),
    });
    console.log(`  video uploaded: ${folder.state.url} (${folder.state.privacy})`);
  }
}

/** Command line: chooses the folders and uploads them. */
class Main {
  /** Reads the options. */
  constructor(args) {
    this.dryRun = args.includes('--dry-run');
    this.unattended = args.includes('--unattended');
    this.videosOnly = args.includes('--videos-only');
    const limitAt = args.indexOf('--limit');
    this.limit = limitAt < 0 ? Infinity : Number(args[limitAt + 1]);
    if (!(this.limit > 0)) throw new Error('--limit needs a number above 0');
    this.slugs = args.filter((a, i) => !a.startsWith('--') && (limitAt < 0 || i !== limitAt + 1));
    this.config = new Config(CONFIG_FILE);
  }

  /** The slugs ticked as finished in the output directory's README table. */
  finishedSlugs() {
    const readme = fs.readFileSync(path.join(this.config.outputDir, 'README.md'), 'utf8');
    return [...readme.matchAll(/^\| \[x\] \|[^|]*\|[^|]*\| `([a-z0-9-]+)`/gm)].map((m) => m[1]);
  }

  /**
   * The newest folder of each chosen slug that still has something to upload. The limit counts only videos that need
   * more than a cover, so a channel that cannot set covers yet does not hold back new uploads.
   */
  folders() {
    const newest = {};
    for (const name of fs.readdirSync(this.config.outputDir).sort()) {
      if (/^\d{4}-\d{2}-\d{2}_.+_v.+$/.test(name)) newest[name.split('_')[1]] = path.join(this.config.outputDir, name);
    }
    const wanted = this.slugs.length ? this.slugs : this.finishedSlugs();
    const missing = wanted.filter((s) => !newest[s]);
    if (missing.length) throw new Error(`No video folder for: ${missing.join(', ')}`);
    const pending = wanted.map((s) => new VideoFolder(newest[s])).filter((f) => (this.videosOnly ? !f.state.videoId : !this.isComplete(f)));
    if (this.videosOnly) return pending.slice(0, this.limit);
    const coverOnly = pending.filter((f) => this.isComplete(f, { ignoreCover: true }));
    return [...pending.filter((f) => !coverOnly.includes(f)).slice(0, this.limit), ...coverOnly];
  }

  /** True when every step of a folder is done (a refused cover is retried on the next run). */
  isComplete(folder, { ignoreCover = false } = {}) {
    const s = folder.state;
    return Boolean(s.videoId && (s.thumbnail || ignoreCover) && s.localizations && s.captions?.length === 4 && (s.playlist || !folder.playlist));
  }

  /** Prints the plan, or uploads until done or out of quota. */
  async run() {
    const folders = this.folders();
    const broken = folders.flatMap((f) => f.problems().map((p) => `${f.name}: ${p}`));
    if (broken.length) throw new Error(`Fix these first:\n${broken.join('\n')}`);
    console.log(`${folders.length} video(s) to upload, visibility ${this.config.privacy}`);
    if (this.dryRun) {
      for (const f of folders) {
        console.log(`\n${f.name}\n  ${f.title}\n  playlist: ${f.playlist}, tags: ${f.tags.length}, languages: ${Object.keys(f.localizations()).join(' ')}`);
        if (folders.length === 1) console.log(JSON.stringify(f.localizations(), null, 2));
      }
      return;
    }
    if (!folders.length) return;
    const youtube = new YouTube(new GoogleAuth(this.config, { unattended: this.unattended }));
    // Asking for the channel name costs quota, which a videos-only run must not depend on.
    if (!this.videosOnly) console.log(`Channel: ${await youtube.channel()}`);
    const uploader = new Uploader(this.config, youtube, { videosOnly: this.videosOnly });
    for (const folder of folders) {
      console.log(`\n${folder.name}`);
      try {
        await uploader.upload(folder);
      } catch (error) {
        if (!error.isOutOfQuota) throw error;
        console.log(`\nDaily quota used up (${error.reason}). Run the same command again tomorrow.`);
        return;
      }
    }
  }
}

Promise.resolve()
  .then(() => new Main(process.argv.slice(2)).run())
  .catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
